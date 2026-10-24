import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteAutomationRepository } from '../../src/infrastructure/persistence/sqlite-automation-repository.js';
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime.js';

let runtime: TestRuntime | undefined;
let dataDirectory: string | undefined;
let automationRepository: SqliteAutomationRepository | undefined;

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  await automationRepository?.close();
  automationRepository = undefined;
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

async function waitForRun(automationId: string, triggerType: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await request(runtime!.app)
      .get(`/api/automations/${automationId}/runs`)
      .expect(200);
    const run = result.body.items.find(
      (item: { triggerType: string }) => item.triggerType === triggerType,
    );
    if (run?.status === 'succeeded' || run?.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The automation run did not finish in time.');
}

describe('automation runtime', () => {
  it('runs a task on demand and stores a single durable notification', async () => {
    dataDirectory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-automation-'));
    runtime = await createTestRuntime({ dataDirectory });
    const created = await request(runtime.app)
      .post('/api/automations')
      .send({
        name: 'Daily check',
        prompt: 'Summarize anything useful for today.',
        trigger: { type: 'interval', intervalMinutes: 60 },
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'active', nextRunAt: expect.any(String) });

    const queued = await request(runtime.app)
      .post(`/api/automations/${created.body.id}/run-now`)
      .expect(202);
    expect(queued.body).toMatchObject({ automationId: created.body.id, status: 'queued' });

    const finished = await waitForRun(created.body.id, 'manual');
    expect(finished).toMatchObject({ status: 'succeeded', result: 'Szia!', attempt: 1 });
    const notification = await request(runtime.app).get('/api/notifications').expect(200);
    expect(notification.body).toMatchObject({ unread: 1 });
    expect(notification.body.items).toHaveLength(1);
    expect(notification.body.items[0].message).toBe('Szia!');

    await request(runtime.app)
      .post(`/api/notifications/${notification.body.items[0].id}/read`)
      .expect(200);
    await expect(
      request(runtime.app).get('/api/notifications').expect(200),
    ).resolves.toMatchObject({
      body: { unread: 0 },
    });
  });

  it('queues a memory event once and preserves automations and run history after reopening', async () => {
    dataDirectory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-automation-'));
    runtime = await createTestRuntime({ dataDirectory });
    const created = await request(runtime.app)
      .post('/api/automations')
      .send({
        name: 'Review new memories',
        prompt: 'Suggest how this new information might help.',
        trigger: { type: 'memory.created' },
      })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Travel', content: 'I enjoy day hikes.' })
      .expect(201);

    const finished = await waitForRun(created.body.id, 'memory.created');
    expect(finished).toMatchObject({ status: 'succeeded', attempt: 1 });
    await runtime.close();
    runtime = undefined;

    runtime = await createTestRuntime({ dataDirectory });
    await expect(
      request(runtime.app).get('/api/automations').expect(200),
    ).resolves.toMatchObject({
      body: {
        items: [
          expect.objectContaining({
            id: created.body.id,
            trigger: { type: 'memory.created' },
          }),
        ],
      },
    });
    const persistedRuns = await request(runtime.app)
      .get(`/api/automations/${created.body.id}/runs`)
      .expect(200);
    expect(persistedRuns.body.items).toHaveLength(1);
    expect(persistedRuns.body.items[0].status).toBe('succeeded');
  });

  it('deduplicates an interval occurrence and makes completion notification insertion idempotent', async () => {
    dataDirectory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-automation-store-'));
    automationRepository = new SqliteAutomationRepository(dataDirectory);
    await automationRepository.initialize();
    const automation = await automationRepository.create({
      name: 'Recurring check',
      prompt: 'Check the current conditions.',
      trigger: { type: 'interval', intervalMinutes: 15 },
    });
    const due = new Date(Date.parse(automation.nextRunAt!) + 1);
    await automationRepository.enqueueDue(due);
    await automationRepository.enqueueDue(due);
    const runs = await automationRepository.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.triggerType).toBe('interval');

    const claimed = await automationRepository.claimNextRun(due);
    expect(claimed?.attempt).toBe(1);
    await automationRepository.completeRun(claimed!.id, 'Weather looks clear.', due);
    await automationRepository.completeRun(claimed!.id, 'Weather looks clear.', due);
    expect((await automationRepository.listNotifications()).items).toHaveLength(1);
  });

  it('retries failed runs with bounded backoff and sends one final failure notification', async () => {
    dataDirectory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-automation-retry-'));
    automationRepository = new SqliteAutomationRepository(dataDirectory);
    await automationRepository.initialize();
    const automation = await automationRepository.create({
      name: 'Retry check',
      prompt: 'Check current conditions.',
      trigger: { type: 'memory.updated' },
    });
    await automationRepository.enqueueEvent('memory.updated', 'memory.updated:fixture:1');
    const initial = await automationRepository.listRuns(automation.id);
    const run = await automationRepository.claimNextRun(new Date());
    expect(run?.attempt).toBe(1);
    const firstFailure = await automationRepository.failRun(run!.id, new Date());
    expect(firstFailure.retryAt).toBeInstanceOf(Date);
    expect(await automationRepository.claimNextRun(new Date())).toBeNull();

    const second = await automationRepository.claimNextRun(firstFailure.retryAt!);
    expect(second?.attempt).toBe(2);
    const secondFailure = await automationRepository.failRun(
      second!.id,
      firstFailure.retryAt!,
    );
    expect(secondFailure.retryAt!.getTime() - firstFailure.retryAt!.getTime()).toBe(120_000);

    const third = await automationRepository.claimNextRun(secondFailure.retryAt!);
    expect(third?.attempt).toBe(3);
    const finalFailure = await automationRepository.failRun(third!.id, secondFailure.retryAt!);
    expect(finalFailure.retryAt).toBeNull();
    const finalRuns = await automationRepository.listRuns(automation.id);
    expect(finalRuns).toHaveLength(initial.length);
    expect(finalRuns[0]).toMatchObject({ status: 'failed', attempt: 3 });
    expect((await automationRepository.listNotifications()).items).toHaveLength(1);
  });
});
