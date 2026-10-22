import { createHash, randomUUID } from 'node:crypto';
import {
  createMemoryInputSchema,
  type CreateMemoryInput,
  type Memory,
  type UpdateMemoryInput,
  updateMemoryInputSchema,
} from '@home-memory/shared';
import type { MemoryRepository } from '../domain/memory-repository.js';
import { ApplicationError, notFoundError } from '../domain/errors.js';
import { MemorySearchService } from './memory-search-service.js';

export interface MemoryEnvelope {
  memory: Memory;
  etag: string;
}

function normalizeForDuplicateCheck(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('hu-HU');
}

const DUPLICATE_STOPWORDS = new Set([
  'a',
  'az',
  'es',
  'is',
  'hogy',
  'nekem',
  'szoktam',
  'vagyok',
  'van',
  'the',
  'a',
  'an',
  'and',
  'i',
  'my',
  'me',
  'to',
  'for',
  'with',
  'prefer',
  'like',
  'szeretem',
  'kedvelem',
]);
const DUPLICATE_SYNONYMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(quiet|quietly|calm|peaceful|nyugodt|csendes|csendesen)\b/gu, 'calm'],
  [/\b(nature|natural|nature-oriented|termeszet|termeszetkozeli)\b/gu, 'nature'],
  [
    /\b(accommodation|accommodations|stay|stays|hotel|hotels|szallas|szallashely|szallasok)\b/gu,
    'stay',
  ],
  [/\b(hiking|hike|tura|turazas|kirandulas)\b/gu, 'hiking'],
];

function duplicateTokens(value: string): Set<string> {
  let normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('hu-HU');
  for (const [pattern, replacement] of DUPLICATE_SYNONYMS)
    normalized = normalized.replace(pattern, replacement);
  return new Set(
    normalized
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/u)
      .filter((token) => token.length > 2 && !DUPLICATE_STOPWORDS.has(token)),
  );
}

function hasConflictingFacts(left: string, right: string): boolean {
  const negations = /\b(nem|nincs|soha|not|never|no|without|without)\b/gu;
  if ([...left.matchAll(negations)].length % 2 !== [...right.matchAll(negations)].length % 2)
    return true;
  const numbers = (value: string) =>
    [...value.matchAll(/\b\d+(?:[.,]\d+)?\b/gu)].map(([n]) => n);
  const leftNumbers = numbers(left);
  const rightNumbers = numbers(right);
  return (
    leftNumbers.length > 0 &&
    rightNumbers.length > 0 &&
    leftNumbers.join(',') !== rightNumbers.join(',')
  );
}

/** Finds exact or high-confidence lexical paraphrase duplicates without merging or writing data. */
export function findMemoryDuplicate(
  memories: Memory[],
  input: CreateMemoryInput,
  exceptId?: string,
): Memory | null {
  const category = normalizeForDuplicateCheck(input.category);
  const content = normalizeForDuplicateCheck(input.content);
  const sameCategory = memories.filter(
    (memory) =>
      memory.id !== exceptId && normalizeForDuplicateCheck(memory.category) === category,
  );
  const exact = sameCategory.find(
    (memory) => normalizeForDuplicateCheck(memory.content) === content,
  );
  if (exact) return exact;

  const proposedTokens = duplicateTokens(input.content);
  if (proposedTokens.size < 3) return null;
  for (const memory of sameCategory) {
    if (hasConflictingFacts(memory.content, input.content)) continue;
    const existingTokens = duplicateTokens(memory.content);
    if (existingTokens.size < 3) continue;
    const overlap = [...proposedTokens].filter((token) => existingTokens.has(token)).length;
    const dice = (2 * overlap) / (proposedTokens.size + existingTokens.size);
    const containment = overlap / Math.min(proposedTokens.size, existingTokens.size);
    if (dice >= 0.8 || (containment >= 0.88 && overlap >= 3)) return memory;
  }
  return null;
}

export function memoryEtag(memory: Memory): string {
  const digest = createHash('sha256').update(JSON.stringify(memory)).digest('base64url');
  return `"sha256-${digest}"`;
}

export class MemoryService {
  private readonly search: MemorySearchService;

  constructor(
    private readonly repository: MemoryRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
    search?: MemorySearchService,
  ) {
    this.search = search ?? new MemorySearchService(repository);
  }

  async list(
    options: {
      q?: string;
      category?: string;
      limit?: number;
      offset?: number;
      view?: 'active' | 'archived' | 'expired' | 'all';
    } = {},
  ): Promise<{ items: MemoryEnvelope[]; total: number }> {
    const memories = await this.repository.list();
    const query = options.q?.trim().toLocaleLowerCase('hu-HU');
    const category = options.category?.trim().toLocaleLowerCase('hu-HU');
    const now = this.now();
    const matching = memories
      .filter((memory) => {
        const expired =
          memory.expiresAt !== null && Date.parse(memory.expiresAt) <= now.getTime();
        switch (options.view ?? 'active') {
          case 'archived':
            return memory.archivedAt !== null;
          case 'expired':
            return memory.archivedAt === null && expired;
          case 'all':
            return true;
          default:
            return memory.archivedAt === null && !expired;
        }
      })
      .filter((memory) => !category || memory.category.toLocaleLowerCase('hu-HU') === category)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    let results = matching;
    if (query) {
      const ranked = await this.search.retrieve(query, matching, {
        limit: matching.length || 1,
        maxContextCharacters: Number.MAX_SAFE_INTEGER,
        ...(options.category ? { category: options.category } : {}),
      });
      results = ranked.map(({ memory }) => memory);
    }
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return {
      total: results.length,
      items: results
        .slice(offset, offset + limit)
        .map((memory) => ({ memory, etag: memoryEtag(memory) })),
    };
  }

  async get(id: string): Promise<MemoryEnvelope> {
    const memory = await this.repository.findById(id);
    if (!memory) throw notFoundError();
    return { memory, etag: memoryEtag(memory) };
  }

  async create(input: CreateMemoryInput): Promise<MemoryEnvelope> {
    const parsed = createMemoryInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApplicationError(
        'INVALID_INPUT',
        'Ellenőrizd a kategóriát és a memória szövegét.',
        400,
      );
    }
    const memory = await this.repository.transaction((transaction) => {
      const existing = findMemoryDuplicate(transaction.list(), parsed.data);
      if (existing) {
        throw new ApplicationError(
          'MEMORY_ALREADY_EXISTS',
          'Ez a memória már szerepel a tárolóban.',
          409,
          {
            existingId: existing.id,
          },
        );
      }
      const now = this.now().toISOString();
      return transaction.create({
        id: this.idFactory(),
        category: parsed.data.category,
        content: parsed.data.content,
        priority: parsed.data.priority,
        createdAt: now,
        updatedAt: now,
        expiresAt: parsed.data.expiresAt ?? null,
        archivedAt: null,
      });
    });
    void this.search.index(memory);
    return { memory, etag: memoryEtag(memory) };
  }

  async update(
    id: string,
    input: UpdateMemoryInput,
    expectedEtag: string,
  ): Promise<MemoryEnvelope> {
    const parsed = updateMemoryInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApplicationError(
        'INVALID_INPUT',
        'Ellenőrizd a kategóriát és a memória szövegét.',
        400,
      );
    }
    const memory = await this.repository.transaction((transaction) => {
      const existing = transaction.findById(id);
      if (!existing) throw notFoundError();
      if (memoryEtag(existing) !== expectedEtag) {
        throw new ApplicationError(
          'STALE_MEMORY',
          'A memória azóta megváltozott. Töltsd újra, és próbáld ismét.',
          412,
        );
      }
      const duplicate = findMemoryDuplicate(transaction.list(), parsed.data, id);
      if (duplicate) {
        throw new ApplicationError(
          'MEMORY_ALREADY_EXISTS',
          'Ez az emlék egy másik memóriával megegyezik.',
          409,
          {
            existingId: duplicate.id,
          },
        );
      }
      const updated = {
        ...existing,
        category: parsed.data.category,
        content: parsed.data.content,
        priority: parsed.data.priority ?? existing.priority,
        updatedAt: this.now().toISOString(),
        expiresAt:
          parsed.data.expiresAt === undefined ? existing.expiresAt : parsed.data.expiresAt,
      };
      return transaction.update(updated);
    });
    void this.search.index(memory);
    return { memory, etag: memoryEtag(memory) };
  }

  async archive(id: string, expectedEtag: string): Promise<MemoryEnvelope> {
    return this.setArchived(id, expectedEtag, true);
  }

  async restore(id: string, expectedEtag: string): Promise<MemoryEnvelope> {
    return this.setArchived(id, expectedEtag, false);
  }

  private async setArchived(
    id: string,
    expectedEtag: string,
    archived: boolean,
  ): Promise<MemoryEnvelope> {
    const memory = await this.repository.transaction((transaction) => {
      const existing = transaction.findById(id);
      if (!existing) throw notFoundError();
      if (memoryEtag(existing) !== expectedEtag) {
        throw new ApplicationError(
          'STALE_MEMORY',
          'A memória azóta megváltozott. Töltsd újra, és próbáld ismét.',
          412,
        );
      }
      return transaction.update({
        ...existing,
        archivedAt: archived ? this.now().toISOString() : null,
        updatedAt: this.now().toISOString(),
      });
    });
    return { memory, etag: memoryEtag(memory) };
  }

  async delete(id: string, expectedEtag: string): Promise<void> {
    await this.repository.transaction((transaction) => {
      const existing = transaction.findById(id);
      if (!existing) throw notFoundError();
      if (memoryEtag(existing) !== expectedEtag) {
        throw new ApplicationError(
          'STALE_MEMORY',
          'A memória azóta megváltozott. Töltsd újra, és próbáld ismét.',
          412,
        );
      }
      transaction.delete(id);
    });
  }
}
