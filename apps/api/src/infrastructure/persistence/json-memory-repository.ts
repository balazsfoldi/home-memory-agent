import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
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

export class JsonMemoryRepository implements MemoryRepository {
  private snapshot: Memory[] = [];
  private embeddings = new Map<
    string,
    { vector: number[]; sourceCategory: string; sourceHash: string; embeddingKey: string }
  >();
  private readonly mutex = new AsyncMutex();
  private releaseProcessLock: (() => Promise<void>) | undefined;
  private initialized = false;
  private healthy = false;

  constructor(private readonly dataDirectory: string) {}

  get isReady(): boolean {
    return this.initialized && this.healthy;
  }

  private get memoriesPath(): string {
    return path.join(this.dataDirectory, 'memories.json');
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
      this.snapshot = await this.readSnapshot();
      this.releaseProcessLock = release;
      this.initialized = true;
      this.healthy = true;
    } catch (error) {
      await release();
      if (error instanceof StoreCorruptError) throw error;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.healthy = false;
    const release = this.releaseProcessLock;
    this.releaseProcessLock = undefined;
    this.initialized = false;
    this.embeddings.clear();
    if (release) await release();
  }

  async list(): Promise<Memory[]> {
    this.assertReady();
    return this.snapshot.map((memory) => ({ ...memory }));
  }

  async findById(id: string): Promise<Memory | null> {
    this.assertReady();
    const memory = this.snapshot.find((item) => item.id === id);
    return memory ? { ...memory } : null;
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
    this.assertReady();
    return [...this.embeddings.entries()].map(([memoryId, entry]) => ({
      memoryId,
      vector: [...entry.vector],
      sourceCategory: entry.sourceCategory,
      sourceHash: entry.sourceHash,
      embeddingKey: entry.embeddingKey,
    }));
  }

  async saveEmbedding(
    memoryId: string,
    vector: number[],
    source: { category: string; content: string },
    embeddingKey: string,
  ): Promise<void> {
    this.assertReady();
    const current = this.snapshot.find((memory) => memory.id === memoryId);
    if (!current || current.category !== source.category || current.content !== source.content)
      return;
    if (!vector.length || vector.some((value) => !Number.isFinite(value))) return;
    this.embeddings.set(memoryId, {
      vector: [...vector],
      sourceCategory: source.category,
      sourceHash: memoryContentFingerprint(source.category, source.content),
      embeddingKey,
    });
  }

  async transaction<T>(
    operation: (transaction: MemoryTransaction) => Promise<T> | T,
  ): Promise<T> {
    this.assertReady();
    return this.mutex.run(async () => {
      this.assertReady();
      const draft = this.snapshot.map((memory) => ({ ...memory }));
      let dirty = false;
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
          dirty = true;
          return { ...result };
        },
        update: (memory) => {
          const index = draft.findIndex((item) => item.id === memory.id);
          if (index < 0) throw new StoreCorruptError('An update referenced a missing memory.');
          draft[index] = { ...memory };
          dirty = true;
          return { ...memory };
        },
        delete: (id) => {
          const index = draft.findIndex((item) => item.id === id);
          if (index < 0)
            throw new StoreCorruptError('A deletion referenced a missing memory.');
          draft.splice(index, 1);
          dirty = true;
        },
      };

      const result = await operation(transaction);
      if (!dirty) return result;
      const previous = this.snapshot;
      await this.writeAtomically(draft);
      this.snapshot = draft.map((memory) => ({ ...memory }));
      const nextIds = new Set(draft.map((memory) => memory.id));
      for (const memory of previous) {
        const updated = draft.find((item) => item.id === memory.id);
        if (
          !nextIds.has(memory.id) ||
          (updated &&
            (updated.content !== memory.content || updated.category !== memory.category))
        )
          this.embeddings.delete(memory.id);
      }
      return result;
    });
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

  private async readSnapshot(): Promise<Memory[]> {
    try {
      const fileStat = await lstat(this.memoriesPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new StoreCorruptError();
      const contents = await readFile(this.memoriesPath, 'utf8');
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new StoreCorruptError();
      const memories = parsed.map((entry) => {
        const result = memorySchema.safeParse(entry);
        if (!result.success) throw new StoreCorruptError();
        return result.data;
      });
      if (new Set(memories.map((memory) => memory.id)).size !== memories.length)
        throw new StoreCorruptError();
      return memories;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof StoreCorruptError) throw error;
        if (error instanceof SyntaxError) throw new StoreCorruptError();
        throw error;
      }
      await this.writeAtomically([]);
      return [];
    }
  }

  private async writeAtomically(memories: Memory[]): Promise<void> {
    const temporaryPath = path.join(this.dataDirectory, `.memories.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(memories, null, 2)}\n`;
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    let replaced = false;
    try {
      fileHandle = await open(temporaryPath, 'wx', 0o600);
      await fileHandle.writeFile(serialized, 'utf8');
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(temporaryPath, this.memoriesPath);
      replaced = true;
      if (process.platform !== 'win32') {
        const directory = await open(this.dataDirectory, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      if (fileHandle) await fileHandle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (replaced) {
        this.healthy = false;
        throw new ApplicationError(
          'STORAGE_UNAVAILABLE',
          'A tárolás állapotát újra kell ellenőrizni. Próbáld újra, miután a tár ismét elérhető.',
          503,
          undefined,
          { cause: error },
        );
      }
      throw new ApplicationError(
        'STORAGE_UNAVAILABLE',
        'A memória mentése nem sikerült.',
        503,
        undefined,
        {
          cause: error,
        },
      );
    }
  }
}
