import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  automationNotificationSchema,
  automationRunSchema,
  automationSchema,
  createAutomationInputSchema,
  type Automation,
  type AutomationNotification,
  type AutomationRun,
  type CreateAutomationInput,
} from '@home-memory/shared';
import { ApplicationError, StoreCorruptError } from '../../domain/errors.js';
import type { AutomationRepository } from '../../domain/automation-repository.js';

interface AutomationRow {
  id: string;
  name: string;
  prompt: string;
  trigger_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
}

interface RunRow {
  id: string;
  automation_id: string;
  trigger_type: string;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  attempt: number;
  result: string | null;
  error: string | null;
}

interface NotificationRow {
  id: string;
  run_id: string;
  automation_id: string;
  title: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

function decodeAutomation(row: AutomationRow): Automation {
  let trigger: unknown;
  try {
    trigger = JSON.parse(row.trigger_json);
  } catch (error) {
    void error;
    throw new StoreCorruptError('An automation trigger is invalid.');
  }
  const result = automationSchema.safeParse({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    trigger,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
  });
  if (!result.success) throw new StoreCorruptError('A stored automation is invalid.');
  return result.data;
}

function decodeRun(row: RunRow): AutomationRun {
  const result = automationRunSchema.safeParse({
    id: row.id,
    automationId: row.automation_id,
    triggerType: row.trigger_type,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    attempt: row.attempt,
    result: row.result,
    error: row.error,
  });
  if (!result.success) throw new StoreCorruptError('A stored automation run is invalid.');
  return result.data;
}

function decodeNotification(row: NotificationRow): AutomationNotification {
  const result = automationNotificationSchema.safeParse({
    id: row.id,
    runId: row.run_id,
    automationId: row.automation_id,
    title: row.title,
    message: row.message,
    createdAt: row.created_at,
    readAt: row.read_at,
  });
  if (!result.success) throw new StoreCorruptError('A stored notification is invalid.');
  return result.data;
}

export class SqliteAutomationRepository implements AutomationRepository {
  private database: DatabaseSync | undefined;

  constructor(private readonly dataDirectory: string) {}

  async initialize(): Promise<void> {
    if (this.database) return;
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    const databasePath = path.join(this.dataDirectory, 'automations.sqlite');
    const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      await chmod(databasePath, 0o600).catch(() => undefined);
      database.exec(
        'PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
      );
      const version = database.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };
      if (version.user_version > 1)
        throw new StoreCorruptError('The automation database is newer than this application.');
      database.exec(`
        CREATE TABLE IF NOT EXISTS automations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          trigger_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          next_run_at TEXT,
          last_run_at TEXT
        );
        CREATE INDEX IF NOT EXISTS automations_due_idx ON automations(status, next_run_at);
        CREATE TABLE IF NOT EXISTS automation_runs (
          id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          idempotency_key TEXT NOT NULL UNIQUE,
          trigger_type TEXT NOT NULL CHECK (trigger_type IN ('interval', 'manual', 'memory.created', 'memory.updated')),
          scheduled_for TEXT NOT NULL,
          next_attempt_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
          attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
          result TEXT,
          error TEXT
        );
        CREATE INDEX IF NOT EXISTS automation_runs_queue_idx ON automation_runs(status, next_attempt_at, scheduled_for);
        CREATE INDEX IF NOT EXISTS automation_runs_history_idx ON automation_runs(automation_id, scheduled_for DESC);
        CREATE TABLE IF NOT EXISTS automation_notifications (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL UNIQUE REFERENCES automation_runs(id) ON DELETE CASCADE,
          automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL,
          read_at TEXT
        );
        CREATE INDEX IF NOT EXISTS automation_notifications_created_idx ON automation_notifications(created_at DESC);
        PRAGMA user_version = 1;
      `);
      this.database = database;
      this.recoverInterruptedRuns(new Date());
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }

  async list(): Promise<Automation[]> {
    return this.db()
      .prepare('SELECT * FROM automations ORDER BY created_at DESC, id')
      .all()
      .map((row) => decodeAutomation(row as unknown as AutomationRow));
  }

  async findById(id: string): Promise<Automation | null> {
    const row = this.db().prepare('SELECT * FROM automations WHERE id = ?').get(id) as
      AutomationRow | undefined;
    return row ? decodeAutomation(row) : null;
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    const parsed = createAutomationInputSchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError(
        'INVALID_INPUT',
        'Check the automation name, prompt, and trigger.',
        400,
      );
    const now = new Date();
    const nowIso = now.toISOString();
    const nextRunAt =
      parsed.data.trigger.type === 'interval'
        ? new Date(now.getTime() + parsed.data.trigger.intervalMinutes * 60_000).toISOString()
        : null;
    const id = randomUUID();
    this.db()
      .prepare(
        `INSERT INTO automations (id, name, prompt, trigger_json, status, created_at, updated_at, next_run_at, last_run_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
      )
      .run(
        id,
        parsed.data.name,
        parsed.data.prompt,
        JSON.stringify(parsed.data.trigger),
        nowIso,
        nowIso,
        nextRunAt,
      );
    const automation = await this.findById(id);
    if (!automation) throw new Error('The automation could not be read after creation.');
    return automation;
  }

  async setStatus(id: string, status: 'active' | 'paused'): Promise<Automation> {
    const existing = await this.findById(id);
    if (!existing) throw this.notFound();
    const now = new Date();
    const nextRunAt =
      status === 'active' && existing.trigger.type === 'interval'
        ? existing.nextRunAt && Date.parse(existing.nextRunAt) > now.getTime()
          ? existing.nextRunAt
          : new Date(now.getTime() + existing.trigger.intervalMinutes * 60_000).toISOString()
        : null;
    this.db()
      .prepare(
        'UPDATE automations SET status = ?, updated_at = ?, next_run_at = ? WHERE id = ?',
      )
      .run(status, now.toISOString(), nextRunAt, id);
    const automation = await this.findById(id);
    if (!automation) throw this.notFound();
    return automation;
  }

  async delete(id: string): Promise<void> {
    const result = this.db().prepare('DELETE FROM automations WHERE id = ?').run(id);
    if (result.changes === 0) throw this.notFound();
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    if (!(await this.findById(automationId))) throw this.notFound();
    return this.db()
      .prepare(
        'SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_for DESC LIMIT 50',
      )
      .all(automationId)
      .map((row) => decodeRun(row as unknown as RunRow));
  }

  async listNotifications(): Promise<{ items: AutomationNotification[]; unread: number }> {
    const database = this.db();
    const unread = database
      .prepare('SELECT COUNT(*) AS count FROM automation_notifications WHERE read_at IS NULL')
      .get() as { count: number };
    const items = database
      .prepare('SELECT * FROM automation_notifications ORDER BY created_at DESC LIMIT 30')
      .all()
      .map((row) => decodeNotification(row as unknown as NotificationRow));
    return { items, unread: unread.count };
  }

  async markNotificationRead(id: string): Promise<AutomationNotification> {
    const database = this.db();
    database
      .prepare(
        'UPDATE automation_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?',
      )
      .run(new Date().toISOString(), id);
    const row = database
      .prepare('SELECT * FROM automation_notifications WHERE id = ?')
      .get(id) as NotificationRow | undefined;
    if (!row) throw this.notFound('The notification was not found.');
    return decodeNotification(row);
  }

  async queueManual(automationId: string): Promise<AutomationRun> {
    const automation = await this.findById(automationId);
    if (!automation) throw this.notFound();
    const database = this.db();
    const active = database
      .prepare(
        "SELECT * FROM automation_runs WHERE automation_id = ? AND status IN ('queued', 'running') ORDER BY scheduled_for DESC LIMIT 1",
      )
      .get(automationId) as RunRow | undefined;
    if (active) return decodeRun(active);
    return this.insertRun(automationId, 'manual', new Date(), `manual:${randomUUID()}`);
  }

  async enqueueEvent(
    type: 'memory.created' | 'memory.updated',
    eventKey: string,
  ): Promise<void> {
    const automations = await this.list();
    const database = this.db();
    const now = new Date().toISOString();
    const insert = database.prepare(
      `INSERT OR IGNORE INTO automation_runs
       (id, automation_id, idempotency_key, trigger_type, scheduled_for, next_attempt_at, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)`,
    );
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const automation of automations) {
        if (automation.status !== 'active' || automation.trigger.type !== type) continue;
        insert.run(
          randomUUID(),
          automation.id,
          `${eventKey}:${automation.id}`,
          type,
          now,
          now,
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async enqueueDue(now: Date): Promise<void> {
    const database = this.db();
    const currentTime = now.getTime();
    database.exec('BEGIN IMMEDIATE');
    try {
      const rows = database
        .prepare(
          "SELECT * FROM automations WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?",
        )
        .all(now.toISOString()) as unknown as AutomationRow[];
      for (const row of rows) {
        const automation = decodeAutomation(row);
        if (automation.trigger.type !== 'interval' || !automation.nextRunAt) continue;
        const scheduledFor = new Date(automation.nextRunAt);
        const intervalMs = automation.trigger.intervalMinutes * 60_000;
        let nextTime = scheduledFor.getTime() + intervalMs;
        while (nextTime <= currentTime) nextTime += intervalMs;
        database
          .prepare(
            `INSERT OR IGNORE INTO automation_runs
             (id, automation_id, idempotency_key, trigger_type, scheduled_for, next_attempt_at, status, attempt)
             VALUES (?, ?, ?, 'interval', ?, ?, 'queued', 0)`,
          )
          .run(
            randomUUID(),
            automation.id,
            `interval:${automation.id}:${scheduledFor.toISOString()}`,
            scheduledFor.toISOString(),
            now.toISOString(),
          );
        database
          .prepare('UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?')
          .run(new Date(nextTime).toISOString(), now.toISOString(), automation.id);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async claimNextRun(now: Date): Promise<AutomationRun | null> {
    const database = this.db();
    database.exec('BEGIN IMMEDIATE');
    try {
      const row = database
        .prepare(
          "SELECT * FROM automation_runs WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at, scheduled_for LIMIT 1",
        )
        .get(now.toISOString()) as RunRow | undefined;
      if (!row) {
        database.exec('COMMIT');
        return null;
      }
      database
        .prepare(
          "UPDATE automation_runs SET status = 'running', attempt = attempt + 1, started_at = ?, finished_at = NULL WHERE id = ? AND status = 'queued'",
        )
        .run(now.toISOString(), row.id);
      const claimed = database
        .prepare('SELECT * FROM automation_runs WHERE id = ?')
        .get(row.id) as RunRow | undefined;
      database.exec('COMMIT');
      return claimed ? decodeRun(claimed) : null;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async completeRun(runId: string, result: string, finishedAt: Date): Promise<void> {
    const database = this.db();
    const row = database
      .prepare('SELECT automation_id FROM automation_runs WHERE id = ?')
      .get(runId) as { automation_id: string } | undefined;
    if (!row) return;
    const automation = database
      .prepare('SELECT name FROM automations WHERE id = ?')
      .get(row.automation_id) as { name: string } | undefined;
    const boundedResult = result.slice(0, 8_000);
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare(
          "UPDATE automation_runs SET status = 'succeeded', result = ?, error = NULL, finished_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(boundedResult, finishedAt.toISOString(), runId);
      database
        .prepare('UPDATE automations SET last_run_at = ?, updated_at = ? WHERE id = ?')
        .run(finishedAt.toISOString(), finishedAt.toISOString(), row.automation_id);
      database
        .prepare(
          'INSERT OR IGNORE INTO automation_notifications (id, run_id, automation_id, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          runId,
          row.automation_id,
          automation?.name ?? 'Automation completed',
          boundedResult,
          finishedAt.toISOString(),
        );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async failRun(runId: string, finishedAt: Date): Promise<{ retryAt: Date | null }> {
    const database = this.db();
    const row = database
      .prepare(
        "SELECT automation_id, attempt FROM automation_runs WHERE id = ? AND status = 'running'",
      )
      .get(runId) as { automation_id: string; attempt: number } | undefined;
    if (!row) return { retryAt: null };
    const shouldRetry = row.attempt < 3;
    const retryAt = shouldRetry
      ? new Date(finishedAt.getTime() + (row.attempt === 1 ? 30_000 : 120_000))
      : null;
    const errorMessage =
      'The task could not be completed. Check the model and tool settings, then try again.';
    database.exec('BEGIN IMMEDIATE');
    try {
      if (retryAt) {
        database
          .prepare(
            "UPDATE automation_runs SET status = 'queued', started_at = NULL, next_attempt_at = ?, error = ? WHERE id = ?",
          )
          .run(retryAt.toISOString(), errorMessage, runId);
      } else {
        database
          .prepare(
            "UPDATE automation_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
          )
          .run(finishedAt.toISOString(), errorMessage, runId);
        database
          .prepare('UPDATE automations SET last_run_at = ?, updated_at = ? WHERE id = ?')
          .run(finishedAt.toISOString(), finishedAt.toISOString(), row.automation_id);
        const automation = database
          .prepare('SELECT name FROM automations WHERE id = ?')
          .get(row.automation_id) as { name: string } | undefined;
        database
          .prepare(
            'INSERT OR IGNORE INTO automation_notifications (id, run_id, automation_id, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            runId,
            row.automation_id,
            automation?.name ?? 'Automation failed',
            errorMessage,
            finishedAt.toISOString(),
          );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { retryAt };
  }

  async hasActiveRun(automationId: string): Promise<boolean> {
    const row = this.db()
      .prepare(
        "SELECT 1 AS present FROM automation_runs WHERE automation_id = ? AND status IN ('queued', 'running') LIMIT 1",
      )
      .get(automationId);
    return Boolean(row);
  }

  private insertRun(
    automationId: string,
    triggerType: AutomationRun['triggerType'],
    scheduledFor: Date,
    idempotencyKey: string,
  ): AutomationRun {
    const database = this.db();
    const id = randomUUID();
    const at = scheduledFor.toISOString();
    database
      .prepare(
        `INSERT INTO automation_runs
         (id, automation_id, idempotency_key, trigger_type, scheduled_for, next_attempt_at, status, attempt)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)`,
      )
      .run(id, automationId, idempotencyKey, triggerType, at, at);
    const row = database.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as
      RunRow | undefined;
    if (!row) throw new Error('The automation run could not be read after creation.');
    return decodeRun(row);
  }

  private recoverInterruptedRuns(now: Date): void {
    const database = this.db();
    const interrupted = database
      .prepare(
        "SELECT id, automation_id, attempt FROM automation_runs WHERE status = 'running'",
      )
      .all() as unknown as Array<{ id: string; automation_id: string; attempt: number }>;
    for (const run of interrupted) {
      if (run.attempt < 3) {
        database
          .prepare(
            "UPDATE automation_runs SET status = 'queued', started_at = NULL, next_attempt_at = ?, error = ? WHERE id = ?",
          )
          .run(
            now.toISOString(),
            'The previous execution was interrupted and will be retried.',
            run.id,
          );
        continue;
      }
      const message = 'The previous execution was interrupted. Run this task again manually.';
      database
        .prepare(
          "UPDATE automation_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
        )
        .run(now.toISOString(), message, run.id);
      const automation = database
        .prepare('SELECT name FROM automations WHERE id = ?')
        .get(run.automation_id) as { name: string } | undefined;
      database
        .prepare(
          'INSERT OR IGNORE INTO automation_notifications (id, run_id, automation_id, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          run.id,
          run.automation_id,
          automation?.name ?? 'Automation failed',
          message,
          now.toISOString(),
        );
    }
  }

  private db(): DatabaseSync {
    if (!this.database) throw new Error('The automation store is not initialized.');
    return this.database;
  }

  private notFound(message = 'The automation was not found.'): ApplicationError {
    return new ApplicationError('AUTOMATION_NOT_FOUND', message, 404);
  }
}
