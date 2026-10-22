import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Memory } from '@home-memory/shared';
import type { EmbeddingProvider } from '../../src/domain/embedding-provider.js';
import { JsonMemoryRepository } from '../../src/infrastructure/persistence/json-memory-repository.js';
import { MemorySearchService } from '../../src/application/memory-search-service.js';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.clear();
});

async function setup() {
  const directory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-semantic-'));
  directories.add(directory);
  const repository = new JsonMemoryRepository(directory);
  await repository.initialize();
  return repository;
}

function memory(id: string, category: string, content: string): Memory {
  return {
    id,
    category,
    content,
    priority: 'normal',
    createdAt: '2026-10-21T18:00:00.000Z',
    updatedAt: '2026-10-21T18:00:00.000Z',
    expiresAt: null,
    archivedAt: null,
  };
}

describe('MemorySearchService', () => {
  it('uses cosine similarity to find paraphrases that lexical search misses', async () => {
    const repository = await setup();
    const calmTrip = memory(
      '11111111-1111-4111-8111-111111111111',
      'Travel',
      'I prefer peaceful accommodation when I take time away.',
    );
    const cooking = memory(
      '22222222-2222-4222-8222-222222222222',
      'Food',
      'I like spicy meals.',
    );
    await repository.transaction((transaction) => {
      transaction.create(calmTrip);
      transaction.create(cooking);
    });
    await repository.saveEmbedding(calmTrip.id, [0.98, 0.2], calmTrip, 'fixture-v1');
    await repository.saveEmbedding(cooking.id, [0.05, 0.99], cooking, 'fixture-v1');
    const provider: EmbeddingProvider = {
      identity: 'fixture-v1',
      embed: vi.fn(async () => [[1, 0]]),
    };
    const search = new MemorySearchService(repository, provider);

    const result = await search.retrieve('quiet places to stay', [calmTrip, cooking], {
      limit: 5,
    });

    expect(result.map(({ memory: item }) => item.id)).toEqual([calmTrip.id]);
  });

  it('builds missing vectors in bounded batches and falls back to lexical search on provider errors', async () => {
    const repository = await setup();
    const first = memory(
      '11111111-1111-4111-8111-111111111111',
      'Hiking',
      'Carry a headlamp.',
    );
    await repository.transaction((transaction) => transaction.create(first));
    await repository.saveEmbedding(first.id, [0, 1], first, 'old-embedding-model');
    const provider: EmbeddingProvider = {
      identity: 'current-embedding-model',
      embed: vi.fn(async (input: string[]) =>
        input.map((text) => (text === 'headlamp hike' ? [1, 0] : [0.99, 0.01])),
      ),
    };
    const search = new MemorySearchService(repository, provider);
    await expect(search.retrieve('headlamp hike', [first])).resolves.toHaveLength(1);
    await expect(repository.listEmbeddings()).resolves.toHaveLength(1);
    expect(provider.embed).toHaveBeenCalledWith(['headlamp hike']);
    expect(provider.embed).toHaveBeenCalledWith(['Hiking: Carry a headlamp.']);
    await expect(repository.listEmbeddings()).resolves.toMatchObject([
      { memoryId: first.id, embeddingKey: 'current-embedding-model' },
    ]);

    const broken: EmbeddingProvider = {
      identity: 'broken-provider',
      embed: vi.fn().mockRejectedValue(new Error('offline')),
    };
    await expect(
      new MemorySearchService(repository, broken).retrieve('headlamp', [first]),
    ).resolves.toHaveLength(1);
  });
});
