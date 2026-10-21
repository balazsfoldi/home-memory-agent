import { randomUUID } from 'node:crypto';
import type { LlmMessage } from '../domain/llm-provider.js';
import { ApplicationError } from '../domain/errors.js';

interface Conversation {
  id: string;
  messages: LlmMessage[];
  updatedAt: number;
  generation: number;
  busy: boolean;
}

export interface ConversationLease {
  id: string;
  messages: LlmMessage[];
  generation: number;
  memoryContextChanged: boolean;
}

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private generation = 0;
  private changedSinceMutation = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly idFactory: () => string = randomUUID,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly maxConversations = 20,
    private readonly maxMessages = 12,
    private readonly maxCharacters = 6_000,
  ) {}

  begin(conversationId?: string): ConversationLease {
    this.evictExpired();
    if (conversationId) {
      const existing = this.conversations.get(conversationId);
      if (!existing)
        throw new ApplicationError(
          'CHAT_EXPIRED',
          'A beszélgetés lejárt. Indíts új beszélgetést.',
          410,
        );
      if (existing.busy)
        throw new ApplicationError(
          'CHAT_ALREADY_RUNNING',
          'A beszélgetés már feldolgozás alatt áll.',
          409,
        );
      existing.busy = true;
      existing.updatedAt = this.now();
      return {
        id: existing.id,
        messages: existing.messages.map((message) => ({ ...message })),
        generation: this.generation,
        memoryContextChanged: this.changedSinceMutation,
      };
    }

    if (this.conversations.size >= this.maxConversations) {
      const oldestIdle = [...this.conversations.values()].find(
        (conversation) => !conversation.busy,
      );
      if (!oldestIdle)
        throw new ApplicationError(
          'SERVICE_BUSY',
          'A beszélgetéslista megtelt. Próbáld újra később.',
          429,
        );
      this.conversations.delete(oldestIdle.id);
    }
    const created: Conversation = {
      id: this.idFactory(),
      messages: [],
      updatedAt: this.now(),
      generation: this.generation,
      busy: true,
    };
    this.conversations.set(created.id, created);
    return {
      id: created.id,
      messages: [],
      generation: this.generation,
      memoryContextChanged: this.changedSinceMutation,
    };
  }

  finish(lease: ConversationLease, userMessage: string, assistantMessage: string): void {
    const conversation = this.conversations.get(lease.id);
    if (
      !conversation ||
      lease.generation !== this.generation ||
      conversation.generation !== lease.generation
    ) {
      throw new ApplicationError(
        'CHAT_CONTEXT_CHANGED',
        'A memóriák az üzenet feldolgozása közben megváltoztak. Küldd el újra.',
        409,
      );
    }
    const history = [
      ...conversation.messages,
      { role: 'user' as const, content: userMessage },
      { role: 'assistant' as const, content: assistantMessage },
    ];
    conversation.messages = this.limitHistory(history);
    conversation.updatedAt = this.now();
    conversation.busy = false;
    conversation.generation = this.generation;
    this.changedSinceMutation = false;
  }

  abort(lease: ConversationLease): void {
    const conversation = this.conversations.get(lease.id);
    if (conversation && conversation.generation === lease.generation)
      conversation.busy = false;
  }

  invalidateAll(): void {
    this.generation += 1;
    this.changedSinceMutation = true;
    this.conversations.clear();
  }

  private limitHistory(messages: LlmMessage[]): LlmMessage[] {
    const result = messages.slice(-this.maxMessages);
    let size = result.reduce((total, message) => total + message.content.length, 0);
    while (result.length && size > this.maxCharacters) {
      const removed = result.shift();
      if (removed) size -= removed.content.length;
    }
    return result;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, conversation] of this.conversations) {
      if (!conversation.busy && conversation.updatedAt < cutoff) this.conversations.delete(id);
    }
  }
}
