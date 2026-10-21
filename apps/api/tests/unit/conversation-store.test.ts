import { describe, expect, it } from 'vitest';
import { ApplicationError } from '../../src/domain/errors.js';
import { ConversationStore } from '../../src/application/conversation-store.js';

describe('ConversationStore', () => {
  it('discards late responses after any memory changes', () => {
    const store = new ConversationStore(
      () => 1_000,
      () => 'conversation-123456',
    );
    const request = store.begin();
    store.invalidateAll();
    expect(() =>
      store.finish(request, 'What do you remember?', 'Something now deleted.'),
    ).toThrowError(ApplicationError);
  });

  it('does not accept a conversation from an earlier generation', () => {
    const store = new ConversationStore(
      () => 1_000,
      () => 'conversation-123456',
    );
    const previous = store.begin();
    store.finish(previous, 'Hello', 'Hi.');
    store.invalidateAll();
    expect(() => store.begin(previous.id)).toThrowError(ApplicationError);
    const next = store.begin();
    expect(next.messages).toEqual([]);
    expect(next.memoryContextChanged).toBe(true);
  });

  it('blocks parallel requests in the same conversation', () => {
    const store = new ConversationStore(
      () => 1_000,
      () => 'conversation-123456',
    );
    const request = store.begin();
    expect(() => store.begin(request.id)).toThrowError(ApplicationError);
    store.abort(request);
    expect(store.begin(request.id).messages).toEqual([]);
  });
});
