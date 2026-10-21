import { describe, expect, it } from 'vitest';
import { renderPolicy } from '../src/policy.js';

describe('renderPolicy', () => {
  it('returns empty string for off', () => {
    expect(renderPolicy({ autoSavePolicy: 'off' })).toBe('');
  });

  it('hint text covers triggers, exclusions, scopes and update flow', () => {
    const text = renderPolicy({ autoSavePolicy: 'hint' });
    for (const needle of [
      'memory_save',
      'proactively',
      'Never save credentials',
      'memory_forget',
      'project',
      'global',
    ]) {
      expect(text).toContain(needle);
    }
  });

  it('hint text stays within budget', () => {
    expect(renderPolicy({ autoSavePolicy: 'hint' }).length).toBeLessThanOrEqual(700);
  });
});
