import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, normalizePath, projectKey, slugify } from './src/store.ts';
import { rank, tokenize } from './src/search.ts';

const vault = await mkdtemp(join(tmpdir(), 'memlite-smoke-'));
const cwd = 'C:\\proj-a';
const results = [];
const check = (name, condition, detail = '') => {
  results.push(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

try {
  const store = new MemoryStore({ vaultPath: vault });
  const saved = await store.save({ title: '交付物偏好', body: 'LaTeX 先转 PDF 再交付', scope: 'global', tags: ['交付'] });

  const note = await readFile(saved.path, 'utf8');
  check('save returns real file path', saved.path.endsWith(`-${saved.id}.md`) && note.includes('LaTeX 先转 PDF 再交付'), saved.path);

  const loaded = await store.get(saved.id, cwd);
  check('global round-trip', loaded.title === '交付物偏好' && loaded.tags[0] === '交付');

  await store.save({ title: '项目 A 约定', body: '用 pnpm 不用 npm', scope: 'project', projectPath: cwd });
  const a = await store.list('project', cwd);
  const b = await store.list('project', 'C:\\proj-b');
  check('project isolation', a.length === 1 && b.length === 0, `a=${a.length} b=${b.length}`);
  check('both scope sees global', (await store.list('both', 'C:\\proj-b')).length === 1);

  const hits = rank('pnpm', await store.list('both', cwd), 8);
  check('rank finds project note', hits[0]?.title === '项目 A 约定', `hits=${hits.length}`);

  const archived = await store.forget(saved.id, cwd);
  let gone = false;
  try { await store.get(saved.id, cwd); } catch { gone = true; }
  check('forget archives', gone && archived.includes('.archive'));

  let refused = false;
  try { await store.save({ title: 'k', body: 'api_key=abc', scope: 'global' }); } catch { refused = true; }
  check('secret refused', refused);

  check('path normalize', normalizePath('C:\\work\\demo\\') === 'c:/work/demo');
  check('project key stable', projectKey('C:\\a') === projectKey('c:/a/'));
  check('slug keeps cjk', slugify('交付物偏好：LaTeX') === '交付物偏好-latex', slugify('交付物偏好：LaTeX'));
  check('tokenize', JSON.stringify(tokenize('交付物 PDF')) === JSON.stringify(['pdf', '交付', '付物']));
} finally {
  await rm(vault, { recursive: true, force: true });
}

console.log(results.join('\n'));
console.log(results.every((r) => r.startsWith('ok')) ? 'ALL OK' : 'FAILURES');
