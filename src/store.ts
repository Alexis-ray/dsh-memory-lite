import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';

export type Scope = 'global' | 'project';
export type Confidence = 'low' | 'medium' | 'high';
export type AnyScope = Scope | 'both';

export interface MemoryRecord {
  id: string;
  title: string;
  body: string;
  scope: Scope;
  projectPath?: string;
  tags: string[];
  confidence: Confidence;
  createdAt: string;
  updatedAt: string;
  source?: string;
}

export interface SaveInput {
  title: string;
  body: string;
  scope?: Scope;
  projectPath?: string;
  tags?: string[];
  confidence?: Confidence;
  source?: string;
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

/** Windows-safe canonical form used as the project key: lowercase drive, `/` separators, no trailing separator. */
export function normalizePath(input: string): string {
  let value = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/^[a-zA-Z]:\//.test(value)) value = `${value[0]?.toLowerCase() ?? ''}${value.slice(1)}`;
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/** Stable per-directory key; renaming the directory produces a new key (documented limitation). */
export function projectKey(cwd: string): string {
  return createHash('sha256').update(normalizePath(cwd)).digest('hex').slice(0, 12);
}

/** Keep letters, digits and CJK; collapse everything else into single dashes. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'memory';
}

function newId(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

const SECRET_PATTERNS = [/api[_-]?key/i, /secret/i, /passw(or)?d/i, /BEGIN [A-Z ]*PRIVATE KEY/, /\btoken\s*[:=]/i];

const MAX_TITLE_CODEPOINTS = 80;

/** Full id shape (`yyyymmdd-hhmm-<4 hex>`); anything shorter is never a lookup key. */
const ID_PATTERN = /^\d{8}-\d{4}-[0-9a-f]{4}$/;

export interface StoreOptions {
  vaultPath: string;
  redactSecrets?: boolean;
  maxFileBytes?: number;
}

/** Markdown-backed memory store. One vault, one directory per project key. */
export class MemoryStore {
  readonly vaultPath: string;
  private readonly redactSecrets: boolean;
  private readonly maxFileBytes: number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: StoreOptions) {
    this.vaultPath = options.vaultPath;
    this.redactSecrets = options.redactSecrets ?? true;
    this.maxFileBytes = options.maxFileBytes ?? 65_536;
  }

  /** Default vault location: `<DSH_HOME>/memory-vault`, else `~/.dsh/memory-vault`. */
  static defaultVaultPath(): string {
    const home = process.env.DSH_HOME?.trim();
    return home ? join(home, 'memory-vault') : join(homedir(), '.dsh', 'memory-vault');
  }

  dirFor(scope: Scope, cwd?: string): string {
    if (scope === 'global') return join(this.vaultPath, 'global');
    if (!cwd) throw new MemoryError('project scope requires a working directory');
    return join(this.vaultPath, 'projects', projectKey(cwd));
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /** Serialize writes to one path so two tool calls cannot interleave. */
  private withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private assertTitle(title: string): string {
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new MemoryError('memory title must not be empty');
    if ([...trimmed].length > MAX_TITLE_CODEPOINTS) {
      throw new MemoryError(`memory title is over ${MAX_TITLE_CODEPOINTS} characters`);
    }
    return trimmed;
  }

  private assertSafe(input: { title: string; body: string }): void {
    if (this.redactSecrets) {
      const haystack = `${input.title}\n${input.body}`;
      const hit = SECRET_PATTERNS.find((re) => re.test(haystack));
      if (hit) throw new MemoryError('refusing to store credential-like content (disable redactSecrets to override)');
    }
  }

  async save(input: SaveInput): Promise<MemoryRecord & { path: string }> {
    const scope = input.scope ?? 'project';
    const title = this.assertTitle(input.title);
    this.assertSafe(input);
    const now = new Date();
    const id = newId(now);
    const dir = this.dirFor(scope, input.projectPath);
    await this.ensureDir(dir);
    if (scope === 'project' && input.projectPath) {
      const meta = join(dir, 'project.json');
      const payload = JSON.stringify({ path: normalizePath(input.projectPath), name: input.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? '' }, null, 2);
      await this.writeAtomic(meta, `${payload}\n`);
    }
    const record: MemoryRecord = {
      id,
      title,
      body: input.body,
      scope,
      ...(scope === 'project' && input.projectPath ? { projectPath: normalizePath(input.projectPath) } : {}),
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      confidence: input.confidence ?? 'medium',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...(input.source === undefined ? {} : { source: input.source }),
    };
    const content = serialize(record);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.maxFileBytes) {
      throw new MemoryError(`memory file is ${bytes} bytes, over the ${this.maxFileBytes} byte limit`);
    }
    const file = join(dir, `${slugify(record.title)}-${record.id}.md`);
    await this.withLock(file, () => this.writeAtomic(file, content));
    return { ...record, path: file };
  }

  /**
   * Read one memory by exact id. Visibility follows SPEC §1: only `global` plus
   * the caller's own project directory (when `cwd` resolves) are searched, so a
   * session in directory B can never read directory A's project memory by id.
   */
  async get(id: string, cwd?: string): Promise<MemoryRecord> {
    return (await this.locate(id, cwd)).record;
  }

  async list(scope: AnyScope, cwd?: string): Promise<MemoryRecord[]> {
    const dirs = this.dirsFor(scope, cwd);
    const out: MemoryRecord[] = [];
    for (const dir of dirs) out.push(...(await readDir(dir)));
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Archive (soft delete) one memory; same per-directory visibility rule as `get`. */
  async forget(id: string, cwd?: string): Promise<string> {
    const { path, record } = await this.locate(id, cwd);
    const archiveDir = join(this.vaultPath, '.archive');
    await this.ensureDir(archiveDir);
    const target = join(archiveDir, `${slugify(record.title)}-${id}.md`);
    const withStamp = serialize({ ...record, updatedAt: new Date().toISOString() }).replace(
      /^---\n/,
      `---\narchivedAt: ${JSON.stringify(new Date().toISOString())}\n`,
    );
    await this.writeAtomic(target, withStamp);
    await fs.rm(path, { force: true });
    return target;
  }

  /**
   * Resolve one id inside the caller's visible directories. The id must be a
   * full `yyyymmdd-hhmm-xxxx` value and the file's own frontmatter must agree,
   * so a suffix or a mislabelled filename can never resolve to a record.
   */
  private async locate(id: string, cwd?: string): Promise<{ path: string; record: MemoryRecord }> {
    if (!ID_PATTERN.test(id)) throw new MemoryError(`memory not found: ${id}`);
    const path = await this.findFile(id, this.allowedDirs(cwd));
    if (!path) throw new MemoryError(`memory not found: ${id}`);
    const record = parse(await fs.readFile(path, 'utf8'));
    if (record.id !== id) throw new MemoryError(`memory not found: ${id}`);
    return { path, record };
  }

  /** Directories one caller may address: `global` plus its own project directory. */
  private allowedDirs(cwd?: string): string[] {
    if (cwd === undefined) return [join(this.vaultPath, 'global')];
    return [join(this.vaultPath, 'global'), this.dirFor('project', cwd)];
  }

  private dirsFor(scope: AnyScope, cwd?: string): string[] {
    if (scope === 'global') return [join(this.vaultPath, 'global')];
    if (scope === 'project') return cwd ? [this.dirFor('project', cwd)] : [];
    return cwd ? [join(this.vaultPath, 'global'), this.dirFor('project', cwd)] : [join(this.vaultPath, 'global')];
  }

  /** Match `<slug>-<id>.md` against the FULL id inside the allowed directories only. */
  private async findFile(id: string, dirs: string[]): Promise<string | undefined> {
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      const hit = entries.find((entry) => entry.endsWith(`-${id}.md`));
      if (hit) return join(dir, hit);
    }
    return undefined;
  }

  /** tmp file + fsync + rename: a kill can lose the write, never leave a torn file. */
  private async writeAtomic(file: string, content: string): Promise<void> {
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  }
}

export function serialize(record: MemoryRecord): string {
  const front = {
    id: record.id,
    title: record.title,
    scope: record.scope,
    ...(record.projectPath === undefined ? {} : { projectPath: record.projectPath }),
    tags: record.tags,
    confidence: record.confidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.source === undefined ? {} : { source: record.source }),
  };
  return `---\n${YAML.stringify(front).trimEnd()}\n---\n\n${record.body.trimEnd()}\n`;
}

export function parse(raw: string): MemoryRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new MemoryError('memory file has no frontmatter');
  const frontRaw = match[1];
  if (frontRaw === undefined) throw new MemoryError('memory file has no frontmatter');
  const front = YAML.parse(frontRaw) as Record<string, unknown>;
  const body = match[2] ?? '';
  return {
    id: String(front.id ?? ''),
    title: String(front.title ?? ''),
    body: body.trim(),
    scope: front.scope === 'global' ? 'global' : 'project',
    ...(typeof front.projectPath === 'string' ? { projectPath: front.projectPath } : {}),
    tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
    confidence: front.confidence === 'low' || front.confidence === 'high' ? front.confidence : 'medium',
    createdAt: String(front.createdAt ?? ''),
    updatedAt: String(front.updatedAt ?? ''),
    ...(typeof front.source === 'string' ? { source: front.source } : {}),
  };
}

async function readDir(dir: string): Promise<MemoryRecord[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: MemoryRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    try {
      out.push(parse(await fs.readFile(join(dir, entry), 'utf8')));
    } catch {
      /* skip unreadable note; never fail the whole listing */
    }
  }
  return out;
}
