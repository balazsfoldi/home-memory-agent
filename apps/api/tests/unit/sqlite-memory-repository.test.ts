import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreCorruptError } from '../../src/domain/errors.js';
import { SqliteMemoryRepository } from '../../src/infrastructure/persistence/sqlite-memory-repository.js';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.clear();
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-sqlite-'));
  directories.add(directory);
  return directory;
}

function memory(id: string, content: string) {
  return {
    id,
    category: 'Hiking',
    content,
    priority: 'normal' as const,
    createdAt: '2026-10-21T18:00:00.000Z',
    updatedAt: '2026-10-21T18:00:00.000Z',
    expiresAt: null,
    archivedAt: null,
  };
}

describe('SqliteMemoryRepository', () => {
  it('imports a legacy JSON store once and preserves that file for recovery', async () => {
    const directory = await temporaryDirectory();
    const legacyPath = path.join(directory, 'memories.json');
    const legacy = {
      id: '11111111-1111-4111-8111-111111111111',
      category: 'Hiking',
      content: 'Always pack a headlamp.',
      priority: 'normal',
      createdAt: '2026-10-21T18:00:00.000Z',
      updatedAt: '2026-10-21T18:00:00.000Z',
    };
    const original = JSON.stringify([legacy]);
    await writeFile(legacyPath, original, 'utf8');

    const repository = new SqliteMemoryRepository(directory);
    await repository.initialize();
    await expect(repository.list()).resolves.toMatchObject([
      { content: 'Always pack a headlamp.', expiresAt: null, archivedAt: null },
    ]);
    await repository.close();
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe(original);

    const reopened = new SqliteMemoryRepository(directory);
    await reopened.initialize();
    await expect(reopened.list()).resolves.toHaveLength(1);
    await reopened.close();
  });

  it('commits transactions atomically and persists expiry, archive state, and embeddings', async () => {
    const directory = await temporaryDirectory();
    const repository = new SqliteMemoryRepository(directory);
    await repository.initialize();
    const first = memory('11111111-1111-4111-8111-111111111111', 'Carry a headlamp.');
    await repository.transaction((transaction) => transaction.create(first));
    await repository.saveEmbedding(first.id, [0.1, 0.2, 0.3], first, 'fixture-v1');

    const expired = {
      ...first,
      expiresAt: '2026-10-20T23:59:59.999Z',
      archivedAt: '2026-10-19T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
    };
    await repository.transaction((transaction) => transaction.update(expired));
    await expect(repository.findById(first.id)).resolves.toEqual(expired);
    await expect(repository.listEmbeddings()).resolves.toMatchObject([
      { memoryId: first.id, vector: [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)] },
    ]);

    await expect(
      repository.transaction((transaction) => {
        transaction.create(memory('22222222-2222-4222-8222-222222222222', 'Do not commit.'));
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await expect(repository.list()).resolves.toHaveLength(1);
    await repository.close();

    const reopened = new SqliteMemoryRepository(directory);
    await reopened.initialize();
    await expect(reopened.list()).resolves.toEqual([expired]);
    await expect(reopened.listEmbeddings()).resolves.toHaveLength(1);
    await reopened.close();
  });

  it('invalidates embeddings when a memory changes and preserves a malformed legacy file', async () => {
    const directory = await temporaryDirectory();
    const repository = new SqliteMemoryRepository(directory);
    await repository.initialize();
    const first = memory('11111111-1111-4111-8111-111111111111', 'Carry a headlamp.');
    await repository.transaction((transaction) => transaction.create(first));
    await repository.saveEmbedding(first.id, [1, 0], first, 'fixture-v1');
    await repository.transaction((transaction) =>
      transaction.update({ ...first, content: 'Carry a compass.' }),
    );
    await repository.saveEmbedding(first.id, [0, 1], first, 'fixture-v1');
    await expect(repository.listEmbeddings()).resolves.toEqual([]);
    await repository.close();

    const badDirectory = await temporaryDirectory();
    const badPath = path.join(badDirectory, 'memories.json');
    await writeFile(badPath, '{invalid', 'utf8');
    const badRepository = new SqliteMemoryRepository(badDirectory);
    await expect(badRepository.initialize()).rejects.toBeInstanceOf(StoreCorruptError);
    await expect(readFile(badPath, 'utf8')).resolves.toBe('{invalid');
  });
});
