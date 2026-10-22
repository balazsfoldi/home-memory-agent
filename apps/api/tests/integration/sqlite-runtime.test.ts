import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

let closeRuntime: (() => Promise<void>) | undefined;
let dataDirectory: string | undefined;

afterEach(async () => {
  await closeRuntime?.();
  closeRuntime = undefined;
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

describe('default SQLite runtime', () => {
  it('imports JSON memories, writes to SQLite, and serves them after restart', async () => {
    dataDirectory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-runtime-'));
    const legacy = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        category: 'Travel',
        content: 'Prefer quiet places.',
        priority: 'normal',
        createdAt: '2026-10-21T18:00:00.000Z',
        updatedAt: '2026-10-21T18:00:00.000Z',
      },
    ];
    const legacyContents = JSON.stringify(legacy);
    await writeFile(path.join(dataDirectory, 'memories.json'), legacyContents, 'utf8');
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_PATH: dataDirectory,
      LLM_PROVIDER: 'none',
    });
    expect(config.storeProvider).toBe('sqlite');

    let runtime = await createRuntime(config);
    closeRuntime = runtime.close;
    const imported = await request(runtime.app).get('/api/memories').expect(200);
    expect(imported.body.items[0].memory).toMatchObject({
      content: 'Prefer quiet places.',
      expiresAt: null,
      archivedAt: null,
    });
    const created = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Home', content: 'Keep spare batteries.' })
      .expect(201);
    await runtime.close();
    closeRuntime = undefined;
    await expect(readFile(path.join(dataDirectory, 'memories.json'), 'utf8')).resolves.toBe(
      legacyContents,
    );

    runtime = await createRuntime(config);
    closeRuntime = runtime.close;
    const persisted = await request(runtime.app).get('/api/memories?view=all').expect(200);
    expect(persisted.body.total).toBe(2);
    expect(
      persisted.body.items.map((item: { memory: { id: string } }) => item.memory.id),
    ).toContain(created.body.memory.id);
  });
});
