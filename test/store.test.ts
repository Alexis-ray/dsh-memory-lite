import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, normalizePath, parse, projectKey, serialize, slugify } from '../src/store.js';
import { rank, tokenize } from '../src/search.js';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'memory-lite-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

async function noTmpLeftovers(root: string): Promise<boolean> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() ?? '';
    let entries: Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.includes('.tmp-')) return false;
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
    }
  }
  return true;
}

describe('paths', () => {
  it('normalizes windows paths', () => {
    expect(normalizePath('C:\\work\\demo\\')).toBe('c:/work/demo');
    expect(normalizePath('c:\\\\a\\\\b')).toBe('c:/a/b');
  });

  it('keys projects stably and case-insensitively on the drive', () => {
    expect(projectKey('C:\\work\\demo')).toBe(projectKey('c:/work/demo/'));
    expect(projectKey('C:\\work\\demo')).not.toBe(projectKey('C:\\work\\demo\\sub'));
  });

  it('slugifies chinese titles and keeps them readable', () => {
    expect(slugify('交付物偏好：LaTeX 转 PDF')).toBe('交付物偏好-latex-转-pdf');
    expect(slugify('!!!')).toBe('memory');
  });
});

describe('store', () => {
  it('round-trips a record through markdown frontmatter', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const saved = await store.save({ title: '交付物偏好', body: '先转 PDF 再交付。', scope: 'global' });
    const loaded = await store.get(saved.id, 'C:\\proj-a');
    expect(loaded.title).toBe('交付物偏好');
    expect(loaded.body).toBe('先转 PDF 再交付。');
    expect(loaded.scope).toBe('global');
    expect(loaded.tags).toEqual([]);
  });

  it('save() returns the real file path and the file exists', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const saved = await store.save({ title: '路径', body: 'x', scope: 'global' });
    expect(saved.path.endsWith(`-${saved.id}.md`)).toBe(true);
    expect(saved.path.startsWith(vault)).toBe(true);
    const raw = await readFile(saved.path, 'utf8');
    expect(raw).toContain(saved.id);
  });

  it('isolates project scope by working directory', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await store.save({ title: '项目 A 约定', body: '用 pnpm', scope: 'project', projectPath: 'C:\\proj-a' });
    expect(await store.list('project', 'C:\\proj-b')).toHaveLength(0);
    expect(await store.list('project', 'C:\\proj-a')).toHaveLength(1);
    expect(await store.list('both', 'C:\\proj-b')).toHaveLength(0);
  });

  it('rejects cross-project get and forget by id', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const saved = await store.save({ title: '项目 A 秘密', body: '只在 A', scope: 'project', projectPath: 'C:\\proj-a' });
    await expect(store.get(saved.id, 'C:\\proj-b')).rejects.toThrow(/not found/);
    await expect(store.forget(saved.id, 'C:\\proj-b')).rejects.toThrow(/not found/);
    // same project still reads it
    expect((await store.get(saved.id, 'C:\\proj-a')).title).toBe('项目 A 秘密');
    // cwd unresolved: global only
    await expect(store.get(saved.id)).rejects.toThrow(/not found/);
  });

  it('matches ids as a full suffix, not a substring', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const a = await store.save({ title: 'one', body: 'x', scope: 'global' });
    const b = await store.save({ title: 'two', body: 'y', scope: 'global' });
    expect(a.id).not.toBe(b.id);
    const suffix = a.id.slice(-4);
    await expect(store.get(suffix, 'C:\\proj-a')).rejects.toThrow(/not found/);
  });

  it('validates titles: non-empty after trim, at most 80 code points', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await expect(store.save({ title: '   ', body: 'x', scope: 'global' })).rejects.toThrow(/title/);
    await expect(store.save({ title: 'あ'.repeat(81), body: 'x', scope: 'global' })).rejects.toThrow(/80/);
    // 80 code points still passes
    await expect(store.save({ title: 'あ'.repeat(80), body: 'x', scope: 'global' })).resolves.toBeTruthy();
  });

  it('archives instead of deleting', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const saved = await store.save({ title: '临时', body: 'x', scope: 'global' });
    const archived = await store.forget(saved.id, 'C:\\proj-a');
    expect((await readdir(join(vault, '.archive'))).length).toBe(1);
    await expect(store.get(saved.id, 'C:\\proj-a')).rejects.toThrow(/not found/);
    const note = await readFile(archived, 'utf8');
    expect(note).toContain('archivedAt:');
  });

  it('refuses credential-like content', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await expect(store.save({ title: 'key', body: 'api_key=sk-1234567890', scope: 'global' })).rejects.toThrow(/credential/);
  });

  it('refuses serialized files over the byte limit and leaves no tmp leftovers', async () => {
    const store = new MemoryStore({ vaultPath: vault, maxFileBytes: 1024 });
    await expect(store.save({ title: 'big', body: 'x'.repeat(2048), scope: 'global' })).rejects.toThrow(/limit/);
    expect(await readdir(join(vault, 'global'))).toHaveLength(0);
    expect(await noTmpLeftovers(vault)).toBe(true);
  });

  it('leaves no *.tmp-* files after normal writes either', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await store.save({ title: 'a', body: 'b', scope: 'global', projectPath: 'C:\\p' });
    await store.save({ title: 'c', body: 'd', scope: 'project', projectPath: 'C:\\p' });
    expect(await noTmpLeftovers(vault)).toBe(true);
  });

  it('scans nested project directories for tmp leftovers', async () => {
    const nested = join(vault, 'projects', 'deadbeefcafe', 'nested', 'a.tmp-1234-abcd');
    await mkdir(dirname(nested), { recursive: true });
    await writeFile(nested, 'x');
    expect(await noTmpLeftovers(vault)).toBe(false);
  });

  it('rejects a file whose frontmatter id does not match the requested id', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await mkdir(join(vault, 'global'), { recursive: true });
    const record = {
      id: '20200101-0000-beef',
      title: 'mislabelled',
      body: 'x',
      scope: 'global' as const,
      tags: [],
      confidence: 'medium' as const,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    await writeFile(join(vault, 'global', 'mislabelled-20200101-0000-dead.md'), serialize(record));
    await expect(store.get('20200101-0000-dead', 'C:\\p')).rejects.toThrow(/memory not found/);
    await expect(store.forget('20200101-0000-dead', 'C:\\p')).rejects.toThrow(/memory not found/);
    await expect(store.get('20200101-0000-beef', 'C:\\p')).rejects.toThrow(/memory not found/);
  });

  it('survives a corrupt index because there is no index file', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    const saved = await store.save({ title: 'a', body: 'b', scope: 'global' });
    await writeFile(join(vault, '.index.json'), '{ not json');
    expect((await store.get(saved.id, 'C:\\p')).id).toBe(saved.id);
  });
});

describe('serialize/parse', () => {
  it('keeps bodies with leading dashes intact', () => {
    const raw = serialize({
      id: '1',
      title: 't',
      body: '- a\n- b',
      scope: 'global',
      tags: ['x'],
      confidence: 'high',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    });
    expect(parse(raw).body).toBe('- a\n- b');
  });
});

describe('search', () => {
  it('tokenizes cjk into bigrams and latin into words', () => {
    expect(tokenize('交付物 PDF')).toEqual(['pdf', '交付', '付物']);
  });

  it('ranks title matches above body matches', async () => {
    const store = new MemoryStore({ vaultPath: vault });
    await store.save({ title: 'pnpm 约定', body: '无关', scope: 'global' });
    await store.save({ title: '其他', body: '这里也提到 pnpm', scope: 'global' });
    const hits = rank('pnpm', await store.list('both'), 8);
    expect(hits[0]?.title).toBe('pnpm 约定');
  });
});
