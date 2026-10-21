import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { MemoryStore } from '../src/store.js';
import { createMemoryTools } from '../src/tools.js';

interface Saved {
  id: string;
  path: string;
  scope: string;
}
interface Hit {
  id: string;
  title: string;
  scope: string;
  snippet: string;
}
interface Listed {
  entries: string[];
}
interface Got {
  id: string;
  title: string;
  body: string;
}
interface Archived {
  archivedPath: string;
}

// Only `agent` and `signal` are read by these tools; the cast keeps the probe stub honest.
const probe = { agent: { id: 'probe' } } as unknown as Parameters<ToolDefinition['execute']>[1];

let vault: string;
let cwd: string;
let tools: Map<string, ToolDefinition>;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'memory-tools-'));
  cwd = 'C:\\proj-a';
  const store = new MemoryStore({ vaultPath: vault });
  const deps = {
    store,
    resolveCwd: async (): Promise<string | undefined> => cwd,
    allowGlobalScope: true,
    defaultLimit: 8,
  };
  tools = new Map(createMemoryTools(deps).map((tool) => [tool.name, tool]));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function call<T>(name: string, args: unknown): Promise<T> {
  const tool = tools.get(name);
  if (tool === undefined) throw new Error(`tool not registered: ${name}`);
  return (await tool.execute(args, probe)) as T;
}

describe('memory_save', () => {
  it('returns id/path/scope and writes a real markdown file', async () => {
    const saved = await call<Saved>('memory_save', {
      title: '交付物偏好',
      body: 'LaTeX 先转 PDF 再交付',
      tags: ['交付'],
    });
    expect(saved.id).toMatch(/^\d{8}-\d{4}-[0-9a-f]{4}$/);
    expect(saved.scope).toBe('project');
    expect(saved.path.endsWith(`-${saved.id}.md`)).toBe(true);
    expect(saved.path.startsWith(vault)).toBe(true);
    expect((await stat(saved.path)).isFile()).toBe(true);
    expect(await readFile(saved.path, 'utf8')).toContain('LaTeX 先转 PDF 再交付');
  });

  it('rejects a call without title through the schema', async () => {
    const error = await call('memory_save', { body: 'x' }).catch((cause: unknown) => cause as Error);
    expect(error.name).toBe('ToolArgsError');
    expect(error.message).toMatch(/invalid arguments/);
  });
});

describe('memory_search', () => {
  it('finds a saved memory and prefers the title hit', async () => {
    await call('memory_save', { title: 'pnpm 约定', body: '这个仓库用 pnpm，不要用 npm' });
    await call('memory_save', { title: '其他事项', body: '顺便提一下 pnpm 也行' });
    const result = await call<{ hits: Hit[] }>('memory_search', { query: 'pnpm' });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]?.title).toBe('pnpm 约定');
    expect(result.hits[0]?.snippet.length).toBeGreaterThan(0);
  });
});

describe('memory_get', () => {
  it('returns the full body', async () => {
    const saved = await call<Saved>('memory_save', {
      title: '多行正文',
      body: '第一行\n第二行\n第三行',
    });
    const record = await call<Got>('memory_get', { id: saved.id });
    expect(record.id).toBe(saved.id);
    expect(record.title).toBe('多行正文');
    expect(record.body).toBe('第一行\n第二行\n第三行');
  });

  it('hides another project\'s record from get and forget', async () => {
    const saved = await call<Saved>('memory_save', { title: 'A 的秘密', body: '只在 A' });
    cwd = 'C:\\proj-b';
    await expect(call('memory_get', { id: saved.id })).rejects.toThrow(/memory not found/);
    await expect(call('memory_forget', { id: saved.id })).rejects.toThrow(/memory not found/);
  });
});

describe('memory_list', () => {
  it('lists entries carrying the full id', async () => {
    const saved = await call<Saved>('memory_save', { title: '列表项', body: 'x' });
    const result = await call<Listed>('memory_list', {});
    expect(result.entries).toHaveLength(1);
    expect(result.entries.some((entry) => entry.includes(saved.id))).toBe(true);
    expect(result.entries.join('\n')).toContain('列表项');
  });
});

describe('memory_forget', () => {
  it('archives the file and makes the id unreadable', async () => {
    const saved = await call<Saved>('memory_save', { title: '临时', body: 'x' });
    const result = await call<Archived>('memory_forget', { id: saved.id });
    expect(result.archivedPath).toContain(join(vault, '.archive'));
    await expect(call('memory_get', { id: saved.id })).rejects.toThrow(/memory not found/);
    expect((await readdir(join(vault, '.archive'))).length).toBe(1);
  });
});

describe('global scope', () => {
  it('is visible from another working directory', async () => {
    const saved = await call<Saved>('memory_save', {
      title: '全局偏好',
      body: '所有项目适用',
      scope: 'global',
    });
    cwd = 'C:\\proj-b';
    const listed = await call<Listed>('memory_list', {});
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries.join('\n')).toContain('全局偏好');
    const record = await call<Got>('memory_get', { id: saved.id });
    expect(record.body).toBe('所有项目适用');
  });
});
