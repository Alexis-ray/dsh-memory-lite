import type { MemoryRecord } from './store.js';
export interface StandingConfig {
    standingMaxItems: number;
    standingBudgetChars: number;
}
/** SPEC §6: global top 3 + current project top 5, then the configured item cap. */
export declare function selectStanding(globalRecords: MemoryRecord[], projectRecords: MemoryRecord[], config: StandingConfig): MemoryRecord[];
/**
 * Render the standing section: one `- <id> · <title> [tags]` line per entry,
 * capped at `standingBudgetChars` characters. Empty input renders empty so the
 * section is never registered.
 */
export declare function renderStanding(entries: readonly MemoryRecord[], config: StandingConfig): string;
