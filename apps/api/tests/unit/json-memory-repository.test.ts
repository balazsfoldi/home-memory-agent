import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonMemoryRepository } from '../../src/infrastructure/persistence/json-memory-repository.js';
import { InstanceAlreadyRunningError, StoreCorruptError } from '../../src/domain/errors.js';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.clear();
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-repository-'));
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

describe('JsonMemoryRepository', () => {
  it('loads v0.1 memories with the default normal priority', async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, 'memories.json');
    const legacy = memory('11111111-1111-4111-8111-111111111111', 'Headlamp');
    delete (legacy as Partial<typeof legacy>).priority;
    await writeFile(file, JSON.stringify([legacy]), 'utf8');
    const repository = new JsonMemoryRepository(directory);
    await repository.initialize();
    await expect(repository.list()).resolves.toMatchObject([{ priority: 'normal' }]);
    await repository.close();
  });

  it('initializes a missing store and recovers committed data after a fresh repository starts', async () => {
    const directory = await temporaryDirectory();
    const first = new JsonMemoryRepository(directory);
    await first.initialize();
    await expect(first.list()).resolves.toEqual([]);
    await first.transaction((transaction) =>
      transaction.create(memory('11111111-1111-4111-8111-111111111111', 'Headlamp')),
    );
    await first.close();

    const reopened = new JsonMemoryRepository(directory);
    await reopened.initialize();
    await expect(reopened.list()).resolves.toMatchObject([{ content: 'Headlamp' }]);
    await reopened.close();
  });

  it('serializes multiple writes without dropping any memories', async () => {
    const directory = await temporaryDirectory();
    const repository = new JsonMemoryRepository(directory);
    await repository.initialize();
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        repository.transaction((transaction) => {
          const id = `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
          transaction.create(memory(id, `Memory ${index}`));
        }),
      ),
    );
    const memories = await repository.list();
    expect(memories).toHaveLength(25);
    await expect(repository.list()).resolves.toHaveLength(25);
    const persisted = JSON.parse(
      await readFile(path.join(directory, 'memories.json'), 'utf8'),
    ) as unknown[];
    expect(persisted).toHaveLength(25);
    expect(new Set(memories.map(({ id }) => id)).size).toBe(25);
    await repository.close();
  });

  it('does not replace a corrupted file and fails startup with a recovery error', async () => {
    const directory = await temporaryDirectory();
    const file = path.join(directory, 'memories.json');
    const corruptContents = '{ "private": "keep this for recovery" }';
    await writeFile(file, corruptContents, 'utf8');
    const repository = new JsonMemoryRepository(directory);
    await expect(repository.initialize()).rejects.toBeInstanceOf(StoreCorruptError);
    await expect(readFile(file, 'utf8')).resolves.toBe(corruptContents);
  });

  it('allows only one process to own the same data directory', async () => {
    const directory = await temporaryDirectory();
    const owner = new JsonMemoryRepository(directory);
    const secondOwner = new JsonMemoryRepository(directory);
    await owner.initialize();
    await expect(secondOwner.initialize()).rejects.toBeInstanceOf(InstanceAlreadyRunningError);
    await owner.close();
    await secondOwner.initialize();
    await secondOwner.close();
  });
});
