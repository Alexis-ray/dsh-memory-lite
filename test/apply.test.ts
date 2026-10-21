import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { apply, type MemoryLiteConfig } from '../src/index.js';
import { MemoryStore } from '../src/store.js';

interface SectionOpts {
  name: string;
  order: number;
  text: string;
}

function makeCtx(cwd: string) {
  const agents: Array<(payload: { agent: unknown; signal?: AbortSignal }) => Promise<undefined>> = [];
  const ctx = {
    tools: { register: (_tool: unknown) => {} },
    on: (event: string, cb: (payload: { agent: unknown; signal?: AbortSignal }) => Promise<undefined>) => {
      expect(event).toBe('agent/created');
      agents.push(cb);
      return () => {};
    },
    workingDirectory: { ensure: async () => cwd },
  };
  return { ctx, fire: async () => {
    const sections: SectionOpts[] = [];
    const agent = {
      ctx: { systemPrompt: { section: (opts: SectionOpts) => sections.push(opts) } },
    };
    for (const cb of agents) await cb({ agent });
    return sections;
  } };
}

function makeConfig(vaultPath: string, over: Partial<MemoryLiteConfig>): MemoryLiteConfig {
  return {
    vaultPath,
    injectStanding: true,
    standingMaxItems: 8,
    standingBudgetChars: 1200,
    allowGlobalScope: true,
    redactSecrets: true,
    maxFileBytes: 65_536,
    autoSavePolicy: 'off',
    ...over,
  };
}

describe('apply section attachment', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'memory-lite-apply-'));
    // One project memory so the standing section actually renders.
    await new MemoryStore({ vaultPath: vault }).save({ title: 'seed memory', body: 'body', scope: 'project', projectPath: vault });
  });

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('policy only: injectStanding=false, autoSavePolicy=hint', async () => {
    const { ctx, fire } = makeCtx(vault);
    apply(ctx as unknown as Context, makeConfig(vault, { injectStanding: false, autoSavePolicy: 'hint' }));
    const sections = await fire();
    expect(sections.map((s) => s.name)).toEqual(['memory-lite:policy']);
    expect(sections[0]).toMatchObject({ order: 401 });
    expect(sections[0].text.length).toBeGreaterThan(0);
  });

  it('both enabled: standing order 400 and policy order 401', async () => {
    const { ctx, fire } = makeCtx(vault);
    apply(ctx as unknown as Context, makeConfig(vault, { injectStanding: true, autoSavePolicy: 'hint' }));
    const sections = await fire();
    const byName = Object.fromEntries(sections.map((s) => [s.name, s]));
    expect(byName['memory-lite:standing']).toMatchObject({ order: 400 });
    expect(byName['memory-lite:policy']).toMatchObject({ order: 401 });
    expect(byName['memory-lite:policy'].text.length).toBeGreaterThan(0);
  });

  it('autoSavePolicy=off: no policy section', async () => {
    const { ctx, fire } = makeCtx(vault);
    apply(ctx as unknown as Context, makeConfig(vault, { injectStanding: true, autoSavePolicy: 'off' }));
    const sections = await fire();
    expect(sections.some((s) => s.name === 'memory-lite:policy')).toBe(false);
  });
});
