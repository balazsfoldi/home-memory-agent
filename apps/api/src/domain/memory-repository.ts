import type { CreateMemoryInput, Memory } from '@home-memory/shared';

export interface MemoryTransaction {
  list(): Memory[];
  findById(id: string): Memory | null;
  create(memory: Memory): Memory;
  update(memory: Memory): Memory;
  delete(id: string): void;
}

export interface MemoryRepository {
  readonly isReady: boolean;
  initialize(): Promise<void>;
  close(): Promise<void>;
  list(): Promise<Memory[]>;
  findById(id: string): Promise<Memory | null>;
  transaction<T>(operation: (transaction: MemoryTransaction) => Promise<T> | T): Promise<T>;
}

export type MemoryFactory = (input: CreateMemoryInput) => Memory;
