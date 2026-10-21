import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { rank } from '../src/search.js';
import { MemoryStore } from '../src/store.js';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g;

/** Bare packages `src/` may depend on (all local, no socket code). */
const ALLOWED_BARE = new Set([
  'yaml',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-working-directory',
]);
const ALLOWED_NODE = new Set(['crypto', 'fs', 'os', 'path']);
const LOCAL_MODULE = /^\.{1,2}\/[A-Za-z0-9._-]+\.js$/;
const EGRESS =
  /^(?:node:)?(?:http|https|net|dns|tls)(?:\/.*)?$|^(?:undici|node-fetch|cross-fetch|whatwg-fetch|isomorphic-fetch|axios|got)$/;

function isAllowed(specifier: string): boolean {
  if (LOCAL_MODULE.test(specifier)) return true;
  if (specifier.startsWith('node:')) return ALLOWED_NODE.has(specifier.slice('node:'.length));
  return ALLOWED_BARE.has(specifier);
}

async function sourceImports(): Promise<Array<{ file: string; specifier: string }>> {
  const files = (await readdir(SRC_DIR)).filter((name) => name.endsWith('.ts')).sort();
  const found: Array<{ file: string; specifier: string }> = [];
  for (const file of files) {
    const source = await readFile(join(SRC_DIR, file), 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push({ file, specifier });
    }
  }
  return found;
}

let vault: string | undefined;

afterEach(async () => {
  if (vault !== undefined) await rm(vault, { recursive: true, force: true });
  vault = undefined;
});

describe('static imports', () => {
  it('only references the offline whitelist', async () => {
    const imports = await sourceImports();
    expect(imports.length).toBeGreaterThan(0);
    const disallowed = imports
      .filter(({ specifier }) => !isAllowed(specifier))
      .map(({ file, specifier }) => `${file}: ${specifier}`);
    expect(disallowed).toEqual([]);
    expect(imports.filter(({ specifier }) => EGRESS.test(specifier))).toEqual([]);
  });
});

describe('runtime egress', () => {
  it('runs save/list/rank/get with every network primitive stubbed to throw', async () => {
    // CJS module objects are the mutable surface for builtins; ESM named bindings are not.
    const require = createRequire(import.meta.url);
    const http = require('node:http') as Record<string, unknown>;
    const https = require('node:https') as Record<string, unknown>;
    const net = require('node:net') as Record<string, unknown>;
    const dns = require('node:dns') as Record<string, unknown>;
    const targets: Array<{ label: string; holder: Record<string, unknown>; key: string }> = [
      { label: 'globalThis.fetch', holder: globalThis as unknown as Record<string, unknown>, key: 'fetch' },
      { label: 'node:http.request', holder: http, key: 'request' },
      { label: 'node:https.request', holder: https, key: 'request' },
      { label: 'node:net.connect', holder: net, key: 'connect' },
      { label: 'node:dns.lookup', holder: dns, key: 'lookup' },
    ];
    const originals = targets.map(({ holder, key }) => holder[key]);
    let attempts = 0;
    vault = await mkdtemp(join(tmpdir(), 'memory-offline-'));
    try {
      for (const { label, holder, key } of targets) {
        holder[key] = (): never => {
          attempts += 1;
          throw new Error(`network access attempted via ${label}`);
        };
      }
      expect(targets.every(({ holder, key }, index) => holder[key] !== originals[index])).toBe(true);
      const store = new MemoryStore({ vaultPath: vault });
      const saved = await store.save({
        title: 'pnpm 约定',
        body: '这个仓库用 pnpm，不要用 npm',
        scope: 'project',
        projectPath: 'C:\\proj-a',
      });
      const records = await store.list('both', 'C:\\proj-a');
      expect(records.map((record) => record.id)).toContain(saved.id);
      const hits = rank('pnpm', records, 8);
      expect(hits[0]?.id).toBe(saved.id);
      const loaded = await store.get(saved.id, 'C:\\proj-a');
      expect(loaded.body).toBe('这个仓库用 pnpm，不要用 npm');
      expect(attempts).toBe(0);
    } finally {
      targets.forEach(({ holder, key }, index) => {
        holder[key] = originals[index];
      });
    }
  });
});
