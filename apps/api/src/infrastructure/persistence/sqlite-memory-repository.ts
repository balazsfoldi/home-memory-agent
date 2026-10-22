import { DatabaseSync } from 'node:sqlite';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { memorySchema, type Memory } from '@home-memory/shared';
import { AsyncMutex } from '../../application/async-mutex.js';
import {
  ApplicationError,
  InstanceAlreadyRunningError,
  StoreCorruptError,
} from '../../domain/errors.js';
import type { MemoryRepository, MemoryTransaction } from '../../domain/memory-repository.js';
import { memoryContentFingerprint } from '../../domain/memory-fingerprint.js';

interface MemoryRow {
  id: string;
  category: string;
  content: string;
  priority: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  archived_at: string | null;
}

interface EmbeddingRow {
  memory_id: string;
  dimensions: number;
  vector: Uint8Array;
  source_category: string;
  source_hash: string;
  embedding_key: string;
}

function decodeMemory(row: MemoryRow): Memory {
  const result = memorySchema.safeParse({
    id: row.id,
    category: row.category,
    content: row.content,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    archivedAt: row.archived_at,
  });
  if (!result.success) throw new StoreCorruptError();
  return result.data;
}

function vectorBytes(vector: number[]): Uint8Array {
  if (!vector.length || vector.some((value) => !Number.isFinite(value)))
    throw new Error('Embedding vectors must contain finite values.');
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  vector.forEach((value, index) =>
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true),
  );
  return bytes;
}

function decodeVector(row: EmbeddingRow): number[] {
  if (row.dimensions <= 0 || row.vector.byteLength !== row.dimensions * 4)
    throw new StoreCorruptError('A stored embedding is invalid.');
  const view = new DataView(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
  return Array.from({ length: row.dimensions }, (_, index) =>
    view.getFloat32(index * 4, true),
  );
}

export class SqliteMemoryRepository implements MemoryRepository {
  private readonly mutex = new AsyncMutex();
  private releaseProcessLock: (() => Promise<void>) | undefined;
  private database: DatabaseSync | undefined;
  private initialized = false;
  private healthy = false;

  constructor(private readonly dataDirectory: string) {}

  get isReady(): boolean {
    return this.initialized && this.healthy;
  }

  private get databasePath(): string {
    return path.join(this.dataDirectory, 'memories.sqlite');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.dataDirectory, {
        realpath: true,
        retries: 0,
        stale: 30_000,
        update: 10_000,
        onCompromised: () => {
          this.healthy = false;
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED')
        throw new InstanceAlreadyRunningError();
      throw error;
    }

    try {
      this.database = new DatabaseSync(this.databasePath, {
        enableForeignKeyConstraints: true,
      });
      await chmod(this.databasePath, 0o600).catch(() => undefined);
      this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.migrateSchema();
      this.importLegacyJson();
      this.releaseProcessLock = release;
      this.initialized = true;
      this.healthy = true;
    } catch (error) {
      this.database?.close();
      this.database = undefined;
      await release();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.healthy = false;
    this.initialized = false;
    this.database?.close();
    this.database = undefined;
    const release = this.releaseProcessLock;
    this.releaseProcessLock = undefined;
    if (release) await release();
  }

  async list(): Promise<Memory[]> {
    return this.mutex.run(() => this.readMemories());
  }

  async findById(id: string): Promise<Memory | null> {
    return this.mutex.run(() => {
      const row = this.db().prepare('SELECT * FROM memories WHERE id = ?').get(id) as
        MemoryRow | undefined;
      return row ? decodeMemory(row) : null;
    });
  }

  async listEmbeddings(): Promise<
    Array<{
      memoryId: string;
      vector: number[];
      sourceCategory: string;
      sourceHash: string;
      embeddingKey: string;
    }>
  > {
    return this.mutex.run(() => {
      const rows = this.db()
        .prepare(
          'SELECT memory_id, dimensions, vector, source_category, source_hash, embedding_key FROM memory_embeddings',
        )
        .all() as unknown as EmbeddingRow[];
      return rows.map((row) => ({
        memoryId: row.memory_id,
        vector: decodeVector(row),
        sourceCategory: row.source_category,
        sourceHash: row.source_hash,
        embeddingKey: row.embedding_key,
      }));
    });
  }

  async saveEmbedding(
    memoryId: string,
    vector: number[],
    source: { category: string; content: string },
    embeddingKey: string,
  ): Promise<void> {
    this.assertReady();
    const bytes = vectorBytes(vector);
    await this.mutex.run(() => {
      this.db()
        .prepare(
          `INSERT INTO memory_embeddings (memory_id, dimensions, vector, source_category, source_hash, embedding_key)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
             SELECT 1 FROM memories WHERE id = ? AND category = ? AND content = ?
           )
           ON CONFLICT(memory_id) DO UPDATE SET dimensions = excluded.dimensions, vector = excluded.vector,
             source_category = excluded.source_category, source_hash = excluded.source_hash,
             embedding_key = excluded.embedding_key`,
        )
        .run(
          memoryId,
          vector.length,
          bytes,
          source.category,
          memoryContentFingerprint(source.category, source.content),
          embeddingKey,
          memoryId,
          source.category,
          source.content,
        );
    });
  }

  async transaction<T>(
    operation: (transaction: MemoryTransaction) => Promise<T> | T,
  ): Promise<T> {
    this.assertReady();
    return this.mutex.run(async () => {
      this.assertReady();
      const database = this.db();
      database.exec('BEGIN IMMEDIATE');
      try {
        const original = this.readMemories();
        const draft = original.map((memory) => ({ ...memory }));
        const changedIds = new Set<string>();
        const deletedIds = new Set<string>();
        const transaction: MemoryTransaction = {
          list: () => draft.map((memory) => ({ ...memory })),
          findById: (id) => {
            const memory = draft.find((item) => item.id === id);
            return memory ? { ...memory } : null;
          },
          create: (memory) => {
            if (draft.some((item) => item.id === memory.id))
              throw new StoreCorruptError('Memory IDs must be unique.');
            const result = { ...memory };
            draft.push(result);
            changedIds.add(result.id);
            deletedIds.delete(result.id);
            return { ...result };
          },
          update: (memory) => {
            const index = draft.findIndex((item) => item.id === memory.id);
            if (index < 0)
              throw new StoreCorruptError('An update referenced a missing memory.');
            draft[index] = { ...memory };
            changedIds.add(memory.id);
            return { ...memory };
          },
          delete: (id) => {
            const index = draft.findIndex((item) => item.id === id);
            if (index < 0)
              throw new StoreCorruptError('A deletion referenced a missing memory.');
            draft.splice(index, 1);
            changedIds.delete(id);
            deletedIds.add(id);
          },
        };

        const result = await operation(transaction);
        if (!changedIds.size && !deletedIds.size) {
          database.exec('ROLLBACK');
          return result;
        }
        const insert = database.prepare(
          `INSERT INTO memories (id, category, content, priority, created_at, updated_at, expires_at, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET category=excluded.category, content=excluded.content,
             priority=excluded.priority, created_at=excluded.created_at, updated_at=excluded.updated_at,
             expires_at=excluded.expires_at, archived_at=excluded.archived_at`,
        );
        const removeEmbedding = database.prepare(
          'DELETE FROM memory_embeddings WHERE memory_id = ?',
        );
        const removeMemory = database.prepare('DELETE FROM memories WHERE id = ?');
        for (const id of deletedIds) removeMemory.run(id);
        for (const id of changedIds) {
          const memory = draft.find((item) => item.id === id);
          if (!memory) throw new StoreCorruptError('A changed memory is missing.');
          const previous = original.find((item) => item.id === id);
          insert.run(
            memory.id,
            memory.category,
            memory.content,
            memory.priority,
            memory.createdAt,
            memory.updatedAt,
            memory.expiresAt,
            memory.archivedAt,
          );
          if (
            previous &&
            (previous.category !== memory.category || previous.content !== memory.content)
          )
            removeEmbedding.run(id);
        }
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    });
  }

  private db(): DatabaseSync {
    this.assertReady();
    if (!this.database)
      throw new ApplicationError('STORAGE_UNAVAILABLE', 'A memóriatár nem érhető el.', 503);
    return this.database;
  }

  private assertReady(): void {
    if (!this.isReady) {
      throw new ApplicationError(
        'STORAGE_UNAVAILABLE',
        'A memóriatár jelenleg nem érhető el.',
        503,
      );
    }
  }

  private readMemories(): Memory[] {
    const rows = this.db()
      .prepare('SELECT * FROM memories ORDER BY created_at, id')
      .all() as unknown as MemoryRow[];
    return rows.map(decodeMemory);
  }

  private migrateSchema(): void {
    const database = this.database;
    if (!database) throw new Error('SQLite database did not open.');
    const versionRow = database.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (versionRow.user_version > 1)
      throw new StoreCorruptError('The SQLite schema is newer than this application.');
    database.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories(updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        vector BLOB NOT NULL,
        source_category TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        embedding_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }

  private importLegacyJson(): void {
    const database = this.database;
    if (!database) throw new Error('SQLite database did not open.');
    const imported = database
      .prepare("SELECT value FROM app_metadata WHERE key = 'legacy_json_imported'")
      .get() as { value: string } | undefined;
    if (imported) return;

    let legacy: Memory[] = [];
    const row = database.prepare('SELECT COUNT(*) AS total FROM memories').get() as {
      total: number;
    };
    if (row.total === 0) {
      try {
        const filePath = path.join(this.dataDirectory, 'memories.json');
        const fileStat = lstatSync(filePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new StoreCorruptError();
        const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed)) throw new StoreCorruptError();
        legacy = parsed.map((entry) => {
          const result = memorySchema.safeParse(entry);
          if (!result.success) throw new StoreCorruptError();
          return result.data;
        });
        if (new Set(legacy.map(({ id }) => id)).size !== legacy.length)
          throw new StoreCorruptError();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (error instanceof StoreCorruptError) throw error;
          if (error instanceof SyntaxError) throw new StoreCorruptError();
          throw error;
        }
      }
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      const insert = database.prepare(
        `INSERT INTO memories (id, category, content, priority, created_at, updated_at, expires_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const memory of legacy)
        insert.run(
          memory.id,
          memory.category,
          memory.content,
          memory.priority,
          memory.createdAt,
          memory.updatedAt,
          memory.expiresAt,
          memory.archivedAt,
        );
      database
        .prepare("INSERT INTO app_metadata (key, value) VALUES ('legacy_json_imported', '1')")
        .run();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
