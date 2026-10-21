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
export declare class MemoryError extends Error {
    constructor(message: string);
}
/** Windows-safe canonical form used as the project key: lowercase drive, `/` separators, no trailing separator. */
export declare function normalizePath(input: string): string;
/** Stable per-directory key; renaming the directory produces a new key (documented limitation). */
export declare function projectKey(cwd: string): string;
/** Keep letters, digits and CJK; collapse everything else into single dashes. */
export declare function slugify(title: string): string;
export interface StoreOptions {
    vaultPath: string;
    redactSecrets?: boolean;
    maxFileBytes?: number;
}
/** Markdown-backed memory store. One vault, one directory per project key. */
export declare class MemoryStore {
    readonly vaultPath: string;
    private readonly redactSecrets;
    private readonly maxFileBytes;
    private readonly locks;
    constructor(options: StoreOptions);
    /** Default vault location: `<DSH_HOME>/memory-vault`, else `~/.dsh/memory-vault`. */
    static defaultVaultPath(): string;
    dirFor(scope: Scope, cwd?: string): string;
    private ensureDir;
    /** Serialize writes to one path so two tool calls cannot interleave. */
    private withLock;
    private assertTitle;
    private assertSafe;
    save(input: SaveInput): Promise<MemoryRecord & {
        path: string;
    }>;
    /**
     * Read one memory by exact id. Visibility follows SPEC §1: only `global` plus
     * the caller's own project directory (when `cwd` resolves) are searched, so a
     * session in directory B can never read directory A's project memory by id.
     */
    get(id: string, cwd?: string): Promise<MemoryRecord>;
    list(scope: AnyScope, cwd?: string): Promise<MemoryRecord[]>;
    /** Archive (soft delete) one memory; same per-directory visibility rule as `get`. */
    forget(id: string, cwd?: string): Promise<string>;
    /**
     * Resolve one id inside the caller's visible directories. The id must be a
     * full `yyyymmdd-hhmm-xxxx` value and the file's own frontmatter must agree,
     * so a suffix or a mislabelled filename can never resolve to a record.
     */
    private locate;
    /** Directories one caller may address: `global` plus its own project directory. */
    private allowedDirs;
    private dirsFor;
    /** Match `<slug>-<id>.md` against the FULL id inside the allowed directories only. */
    private findFile;
    /** tmp file + fsync + rename: a kill can lose the write, never leave a torn file. */
    private writeAtomic;
}
export declare function serialize(record: MemoryRecord): string;
export declare function parse(raw: string): MemoryRecord;
