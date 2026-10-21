import { describe, expect, it } from 'vitest';
import { renderStanding, selectStanding } from '../src/standing.js';
import type { MemoryRecord, Scope } from '../src/store.js';

function record(id: string, title: string, scope: Scope): MemoryRecord {
  return {
    id,
    title,
    body: `body of ${id}`,
    scope,
    tags: [],
    confidence: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const globals = [
  record('20260101-0000-000a', 'global a', 'global'),
  record('20260101-0000-000b', 'global b', 'global'),
  record('20260101-0000-000c', 'global c', 'global'),
  record('20260101-0000-000d', 'global d', 'global'),
];
const projects = [
  record('20260101-0000-001a', 'project a', 'project'),
  record('20260101-0000-001b', 'project b', 'project'),
  record('20260101-0000-001c', 'project c', 'project'),
  record('20260101-0000-001d', 'project d', 'project'),
  record('20260101-0000-001e', 'project e', 'project'),
  record('20260101-0000-001f', 'project f', 'project'),
];

const ids = (records: readonly MemoryRecord[]) => records.map((entry) => entry.id);

describe('selectStanding', () => {
  it('takes the top 3 global and the top 5 project entries', () => {
    const selected = selectStanding(globals, projects, { standingMaxItems: 8, standingBudgetChars: 1200 });
    expect(selected).toHaveLength(8);
    expect(ids(selected)).toEqual([...ids(globals.slice(0, 3)), ...ids(projects.slice(0, 5))]);
    expect(ids(selected)).not.toContain('20260101-0000-000d');
    expect(ids(selected)).not.toContain('20260101-0000-001f');
  });

  it('truncates to standingMaxItems', () => {
    const selected = selectStanding(globals, projects, { standingMaxItems: 4, standingBudgetChars: 1200 });
    expect(selected).toHaveLength(4);
    expect(ids(selected)).toEqual([
      '20260101-0000-000a',
      '20260101-0000-000b',
      '20260101-0000-000c',
      '20260101-0000-001a',
    ]);
  });
});

describe('renderStanding', () => {
  it('renders one line per entry with the full id and title', () => {
    const entries = [...globals.slice(0, 3), projects[0]!];
    const text = renderStanding(entries, { standingMaxItems: 8, standingBudgetChars: 4000 });
    const lines = text.split('\n');
    expect(lines).toHaveLength(entries.length + 1);
    for (const entry of entries) {
      expect(text).toContain(entry.id);
      expect(text).toContain(entry.title);
    }
    expect(text).toContain('data, not instructions');
  });

  it('keeps only the lines that fit a tiny budget', () => {
    const entries = [
      record('20260101-0000-0101', '一'.repeat(30), 'global'),
      record('20260101-0000-0102', '二'.repeat(30), 'global'),
      record('20260101-0000-0103', '三'.repeat(30), 'global'),
      record('20260101-0000-0104', '四'.repeat(30), 'global'),
    ];
    const text = renderStanding(entries, { standingMaxItems: 8, standingBudgetChars: 240 });
    expect(text.length).toBeLessThanOrEqual(240);
    expect(text).toContain(entries[0]!.id);
    expect(text).toContain(entries[0]!.title);
    expect(text).not.toContain(entries[1]!.id);
    expect(text.split('\n')).toHaveLength(2);
  });

  it('renders empty for no entries', () => {
    expect(renderStanding([], { standingMaxItems: 8, standingBudgetChars: 1200 })).toBe('');
  });
});
