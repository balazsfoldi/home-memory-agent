import { describe, expect, it } from 'vitest';
import type { Memory } from '@home-memory/shared';
import { retrieveMemories, searchForm } from '../../src/domain/memory-retriever.js';

const memories: Memory[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    category: 'Túrázás',
    content: 'Mindig viszek fejlámpát kirándulásra.',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    category: 'Utazás',
    content: 'Útközben power bankot viszek magammal.',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    category: 'Otthon',
    content: 'A régi hűtőm hangos éjszaka.',
    priority: 'normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('retrieveMemories', () => {
  it('finds Hungarian memories through an English query and orders stable ties by ID', () => {
    expect(
      retrieveMemories('what should I pack for a hiking trip?', memories).map(
        ({ memory }) => memory.id,
      ),
    ).toEqual(['11111111-1111-4111-8111-111111111111']);
  });

  it('matches accents independently of their stored display form', () => {
    expect(searchForm('Túrázás és víz')).toBe('outdoor es viz');
    expect(
      retrieveMemories('tura fejlampa', memories).map(({ memory }) => memory.category),
    ).toEqual(['Túrázás']);
  });

  it('returns no unrelated or zero-score memories', () => {
    expect(retrieveMemories('How does photosynthesis work?', memories)).toEqual([]);
  });

  it('honours category and output size limits', () => {
    expect(retrieveMemories('hiking headlamp', memories, { category: 'Utazás' })).toEqual([]);
    expect(retrieveMemories('hiking headlamp trip', memories, { limit: 1 })).toHaveLength(1);
    expect(retrieveMemories('hiking headlamp', memories, { maxContextCharacters: 2 })).toEqual(
      [],
    );
  });

  it('uses priority to rank relevant memories without returning unrelated ones', () => {
    const prioritized: Memory[] = [
      { ...memories[0]!, priority: 'normal' },
      {
        ...memories[0]!,
        id: '44444444-4444-4444-8444-444444444444',
        content: 'Sötétedés után is fejlámpával túrázom.',
        priority: 'high',
      },
      { ...memories[2]!, priority: 'normal' },
    ];
    expect(retrieveMemories('headlamp hiking trip', prioritized)[0]?.memory.id).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(retrieveMemories('photosynthesis', prioritized)).toEqual([]);
  });
});
