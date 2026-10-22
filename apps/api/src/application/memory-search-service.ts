import type { Memory } from '@home-memory/shared';
import type { EmbeddingProvider } from '../domain/embedding-provider.js';
import type { MemoryRepository } from '../domain/memory-repository.js';
import {
  retrieveMemories,
  searchForm,
  type RetrievalOptions,
  type RetrievedMemory,
} from '../domain/memory-retriever.js';
import { memoryContentFingerprint } from '../domain/memory-fingerprint.js';

function embeddingText(memory: Memory): string {
  return `${memory.category}: ${memory.content}`;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export class MemorySearchService {
  private indexing: Promise<void> | undefined;

  constructor(
    private readonly repository: MemoryRepository,
    private readonly provider?: EmbeddingProvider,
  ) {}

  async index(memory: Memory): Promise<void> {
    if (!this.provider) return;
    try {
      const [vector] = await this.provider.embed([embeddingText(memory)]);
      if (vector)
        await this.repository.saveEmbedding(memory.id, vector, memory, this.provider.identity);
    } catch {
      // Memory CRUD remains available if an optional embedding endpoint is down.
    }
  }

  async retrieve(
    query: string,
    memories: Memory[],
    options: RetrievalOptions = {},
  ): Promise<RetrievedMemory[]> {
    const lexical = retrieveMemories(query, memories, {
      ...options,
      limit: memories.length || 1,
      maxContextCharacters: Number.MAX_SAFE_INTEGER,
    });
    if (!this.provider) return retrieveMemories(query, memories, options);

    try {
      const [queryVector] = await this.provider.embed([query.slice(-4_000)]);
      if (!queryVector?.length) return retrieveMemories(query, memories, options);
      const stored = await this.repository.listEmbeddings();
      const memoriesById = new Map(memories.map((memory) => [memory.id, memory]));
      const embeddings = new Map<string, number[]>();
      for (const entry of stored) {
        const memory = memoriesById.get(entry.memoryId);
        if (
          memory &&
          entry.embeddingKey === this.provider.identity &&
          entry.sourceCategory === memory.category &&
          entry.sourceHash === memoryContentFingerprint(memory.category, memory.content)
        )
          embeddings.set(entry.memoryId, entry.vector);
      }
      const missing = memories.filter((memory) => !embeddings.has(memory.id));
      if (missing.length && !this.indexing) {
        const firstBatch = missing.slice(0, 16);
        const first = this.indexBatch(firstBatch);
        this.indexing = first
          .then(async () => {
            for (let index = 16; index < missing.length; index += 16)
              await this.indexBatch(missing.slice(index, index + 16));
          })
          .catch(() => undefined)
          .finally(() => {
            this.indexing = undefined;
          });
        await first;
        const indexedVectors = await this.repository.listEmbeddings();
        const indexedById = new Map(
          indexedVectors
            .filter((entry) => {
              const memory = memoriesById.get(entry.memoryId);
              return (
                memory &&
                entry.embeddingKey === this.provider?.identity &&
                entry.sourceCategory === memory.category &&
                entry.sourceHash === memoryContentFingerprint(memory.category, memory.content)
              );
            })
            .map((entry) => [entry.memoryId, entry.vector]),
        );
        for (const memory of firstBatch) {
          const indexed = indexedById.get(memory.id);
          if (indexed) embeddings.set(memory.id, indexed);
        }
      }
      const lexicalScores = new Map(lexical.map(({ memory, score }) => [memory.id, score]));
      const maximumLexical = Math.max(1, ...lexicalScores.values());
      const ranked: RetrievedMemory[] = [];
      for (const memory of memories) {
        const vector = embeddings.get(memory.id);
        const similarity = vector ? cosineSimilarity(queryVector, vector) : -1;
        const lexicalScore = lexicalScores.get(memory.id) ?? 0;
        if (similarity < 0.12 && lexicalScore <= 0) continue;
        const normalizedLexical = lexicalScore / maximumLexical;
        const priorityBoost =
          memory.priority === 'high' ? 0.025 : memory.priority === 'low' ? -0.01 : 0;
        ranked.push({
          memory,
          score: Math.max(
            1,
            (Math.max(0, similarity) * 0.82 + normalizedLexical * 0.18 + priorityBoost) * 100,
          ),
        });
      }
      ranked.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
      const result: RetrievedMemory[] = [];
      let characters = 0;
      for (const candidate of ranked) {
        if (result.length >= (options.limit ?? 5)) break;
        if (
          options.category &&
          searchForm(options.category) !== searchForm(candidate.memory.category)
        )
          continue;
        const size = candidate.memory.category.length + candidate.memory.content.length;
        if (characters + size > (options.maxContextCharacters ?? 6_000)) continue;
        result.push(candidate);
        characters += size;
      }
      return result;
    } catch {
      return retrieveMemories(query, memories, options);
    }
  }

  private async indexBatch(memories: Memory[]): Promise<void> {
    const provider = this.provider;
    if (!provider || !memories.length) return;
    const vectors = await provider.embed(memories.map(embeddingText));
    if (vectors.length !== memories.length)
      throw new Error('The embedding response was incomplete.');
    const dimensions = vectors[0]?.length;
    if (!dimensions || vectors.some((vector) => vector.length !== dimensions))
      throw new Error('The embedding response has inconsistent dimensions.');
    await Promise.all(
      memories.map((memory, index) => {
        const vector = vectors[index];
        return vector
          ? this.repository.saveEmbedding(memory.id, vector, memory, provider.identity)
          : Promise.resolve();
      }),
    );
  }
}
