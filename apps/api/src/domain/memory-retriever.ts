import type { Memory } from '@home-memory/shared';

const STOPWORDS = new Set([
  'a',
  'az',
  'es',
  'is',
  'hogy',
  'ezt',
  'azt',
  'nekem',
  'neked',
  'mikor',
  'mit',
  'hogyan',
  'milyen',
  'kell',
  'van',
  'volt',
  'vagyok',
  'vagy',
  'the',
  'a',
  'an',
  'and',
  'or',
  'is',
  'are',
  'to',
  'for',
  'on',
  'in',
  'of',
  'my',
  'me',
  'you',
  'what',
  'when',
  'how',
  'should',
  'would',
  'could',
  'please',
  'i',
  'remember',
  'forget',
  'that',
  'this',
  'about',
  'have',
  'with',
]);

const SEARCH_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(hiking|hike|hikes|tura|turazas|turazni|turazok|turan|turak|kirandulas|kirandulni)\b/gu,
    'outdoor',
  ],
  [/\b(travel|travelling|utazas|utazni|utazok|uton)\b/gu, 'travel'],
  [/\b(food|meal|meals|eating|etel|etelek|enni|etkezes|kaja)\b/gu, 'food'],
  [/\b(home|house|otthon|haz|lakas)\b/gu, 'home'],
];

export interface RetrievedMemory {
  memory: Memory;
  score: number;
}

export interface RetrievalOptions {
  limit?: number;
  category?: string;
  maxContextCharacters?: number;
}

export function searchForm(value: string): string {
  let result = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('hu-HU');
  for (const [pattern, replacement] of SEARCH_ALIASES)
    result = result.replace(pattern, replacement);
  return result.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value: string): string[] {
  return [
    ...new Set(
      searchForm(value)
        .split(/\s+/u)
        .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
    ),
  ];
}

export function retrieveMemories(
  query: string,
  memories: Memory[],
  options: RetrievalOptions = {},
): RetrievedMemory[] {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return [];
  const queryTokenSet = new Set(queryTokens);
  const normalizedQuery = searchForm(query);
  const candidates: RetrievedMemory[] = [];

  for (const memory of memories) {
    if (options.category && searchForm(memory.category) !== searchForm(options.category))
      continue;
    const categoryTokens = tokens(memory.category);
    const contentTokens = tokens(memory.content);
    let score = 0;
    for (const token of new Set(categoryTokens)) {
      if (queryTokenSet.has(token)) score += 3;
      else if (
        [...queryTokenSet].some(
          (queryToken) => queryToken.length >= 4 && token.startsWith(queryToken),
        )
      )
        score += 3;
    }
    for (const token of new Set(contentTokens)) {
      if (queryTokenSet.has(token)) score += 1;
      else if (
        [...queryTokenSet].some(
          (queryToken) => queryToken.length >= 4 && token.startsWith(queryToken),
        )
      )
        score += 1;
    }
    const normalizedCategory = searchForm(memory.category);
    const normalizedContent = searchForm(memory.content);
    if (normalizedCategory.length > 2 && normalizedQuery.includes(normalizedCategory))
      score += 2;
    if (normalizedContent.length > 8 && normalizedQuery.includes(normalizedContent))
      score += 2;
    if (score > 0) {
      const priorityBoost =
        memory.priority === 'high' ? 2 : memory.priority === 'low' ? -1 : 0;
      candidates.push({ memory, score: Math.max(1, score + priorityBoost) });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
  const result: RetrievedMemory[] = [];
  let characters = 0;
  for (const candidate of candidates) {
    if (result.length >= (options.limit ?? 5)) break;
    const size = candidate.memory.category.length + candidate.memory.content.length;
    if (characters + size > (options.maxContextCharacters ?? 6_000)) continue;
    result.push(candidate);
    characters += size;
  }
  return result;
}
