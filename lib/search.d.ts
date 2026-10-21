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
/**
 * Tokenize for lexical recall: latin/digit runs stay whole, CJK runs break into
 * overlapping bigrams (single-character runs stay whole). No stemming, no synonyms.
 */
export declare function tokenize(text: string): string[];
/** Rank by title x3, tags x2, body x1 and prefer recently touched records on ties. */
export declare function rank(query: string, records: MemoryRecord[], limit: number): Hit[];
