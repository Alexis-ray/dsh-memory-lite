import type { MemoryStore } from './store.js';
export interface ToolDeps {
    store: MemoryStore;
    /** Resolve the calling agent's working directory; undefined when it cannot be resolved. */
    resolveCwd: (exec: {
        agent?: unknown;
        signal?: AbortSignal;
    }) => Promise<string | undefined>;
    allowGlobalScope: boolean;
    /** Default hit/entry cap for memory_search and memory_list; independent of the standing section. */
    defaultLimit: number;
}
/**
 * Build the five model-facing tools. Kept as a factory so the plugin entry owns
 * configuration and this module stays unit-testable without a Cordis context.
 * `get`/`forget`/`save` all resolve the caller's cwd first: per SPEC §1 the
 * store then only ever sees `global` plus that one project directory.
 */
export declare function createMemoryTools(deps: ToolDeps): import("@deepseek-ai/dsh-tools").ToolDefinition[];
