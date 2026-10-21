import type { MemoryRecord } from './store.js';

export interface Hit {
  id: string;
  title: string;
  scope: string;
  tags: string[];
  updatedAt: string;
  score: number;
  snippet: string;
}

const WORD = /[a-z0-9_]+/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * Tokenize for lexical recall: latin/digit runs stay whole, CJK runs break into
 * overlapping bigrams (single-character runs stay whole). No stemming, no synonyms.
 */
export function tokenize(text: string): string[] {
  const lower = text.normalize('NFKC').toLowerCase();
  const tokens: string[] = [];
  for (const match of lower.matchAll(WORD)) tokens.push(match[0]);
  let run = '';
  const flush = () => {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
    run = '';
  };
  for (const char of lower) {
    if (CJK.test(char)) run += char;
    else flush();
  }
  flush();
  return tokens.filter((token) => token.length > 0);
}

function countTokens(haystack: string[], wanted: Set<string>): number {
  let hits = 0;
  for (const token of haystack) if (wanted.has(token)) hits += 1;
  return hits;
}

/** Rank by title x3, tags x2, body x1 and prefer recently touched records on ties. */
export function rank(query: string, records: MemoryRecord[], limit: number): Hit[] {
  const wanted = new Set(tokenize(query));
  if (wanted.size === 0) return [];
  const scored: Hit[] = [];
  for (const record of records) {
    const titleHits = countTokens(tokenize(record.title), wanted);
    const tagHits = countTokens(tokenize(record.tags.join(' ')), wanted);
    const bodyHits = countTokens(tokenize(record.body), wanted);
    const score = titleHits * 3 + tagHits * 2 + bodyHits;
    if (score === 0) continue;
    scored.push({
      id: record.id,
      title: record.title,
      scope: record.scope,
      tags: record.tags,
      updatedAt: record.updatedAt,
      score,
      snippet: snippet(record.body, wanted),
    });
  }
  scored.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return scored.slice(0, limit);
}

function snippet(body: string, wanted: Set<string>): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const tokens = tokenize(flat);
  for (let i = 0; i < tokens.length; i += 1) {
    if (wanted.has(tokens[i] ?? '')) continue;
    const approx = Math.max(0, i * 4 - 60);
    return `${approx > 0 ? '…' : ''}${flat.slice(approx, approx + 200)}${flat.length > approx + 200 ? '…' : ''}`;
  }
  return flat.slice(0, 200);
}
