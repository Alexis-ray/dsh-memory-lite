import { defineTool } from '@deepseek-ai/dsh-tools';
import { rank } from './search.js';
const text = (value) => [{ type: 'text', text: value }];
const SAVE_SCOPES = ['project', 'global'];
const SAVE_SCOPES_PROJECT_ONLY = ['project'];
const LIST_SCOPES = ['both', 'project', 'global'];
const CONFIDENCE = ['low', 'medium', 'high'];
function describe(id, title, tags, scope, updatedAt) {
    const tagSuffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    return `- ${id} · ${title}${tagSuffix} — ${scope}, ${updatedAt.slice(0, 10)}`;
}
/**
 * Build the five model-facing tools. Kept as a factory so the plugin entry owns
 * configuration and this module stays unit-testable without a Cordis context.
 * `get`/`forget`/`save` all resolve the caller's cwd first: per SPEC §1 the
 * store then only ever sees `global` plus that one project directory.
 */
export function createMemoryTools(deps) {
    const { store } = deps;
    const save = defineTool({
        name: 'memory_save',
        description: 'Store one durable memory that must survive across sessions. Use for stable preferences, project decisions, environment facts and recurring pitfalls. ' +
            'Default scope is `project` (this working directory only); use `global` only for facts true everywhere. Never store credentials.',
        parameters: {
            title: { type: 'string', required: true, description: 'One-line title, at most 80 characters.' },
            body: { type: 'string', required: true, description: 'Markdown body: the fact, why it matters, and how to apply it.' },
            scope: {
                type: 'string',
                enum: deps.allowGlobalScope ? SAVE_SCOPES : SAVE_SCOPES_PROJECT_ONLY,
                description: '`project` = only this working directory; `global` = every workspace.',
            },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional retrieval tags.' },
            confidence: { type: 'string', enum: CONFIDENCE, description: 'How sure the fact still holds.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                    scope: { type: 'string', required: true },
                },
            },
            render: (_args, value) => text(`Saved memory ${value.id} (${value.scope}) to ${value.path}.`),
        },
        async execute(args, exec) {
            const cwd = await deps.resolveCwd(exec);
            const scope = args.scope ?? 'project';
            if (scope === 'project' && cwd === undefined)
                throw new Error('memory_save: cannot resolve the working directory');
            const record = await store.save({
                title: args.title,
                body: args.body,
                scope,
                ...(cwd === undefined ? {} : { projectPath: cwd }),
                ...(args.tags === undefined ? {} : { tags: args.tags }),
                ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
            });
            return { id: record.id, path: record.path, scope: record.scope };
        },
    });
    const search = defineTool({
        name: 'memory_search',
        description: 'Search durable memory by keywords. Searches global memory plus the current working directory by default. ' +
            'Returns titles and snippets only — call `memory_get` for the full text of a hit.',
        parameters: {
            query: { type: 'string', required: true, description: 'Keywords; CJK is matched as bigrams, latin as words.' },
            scope: { type: 'string', enum: LIST_SCOPES, description: 'Default `both`: global + current working directory.' },
            limit: { type: 'integer', description: `Max hits (default ${deps.defaultLimit}).` },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    hits: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                title: { type: 'string', required: true },
                                scope: { type: 'string', required: true },
                                snippet: { type: 'string', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => text(value.hits.length === 0
                ? 'No memory matched.'
                : value.hits.map((hit, index) => `${index + 1}. ${hit.id} · ${hit.title} (${hit.scope})\n   ${hit.snippet}`).join('\n')),
        },
        async execute(args, exec) {
            const cwd = await deps.resolveCwd(exec);
            const records = await store.list(args.scope ?? 'both', cwd);
            const hits = rank(args.query, records, Math.min(args.limit ?? deps.defaultLimit, 50));
            return { hits: hits.map(({ id, title, scope, snippet }) => ({ id, title, scope, snippet })) };
        },
    });
    const get = defineTool({
        name: 'memory_get',
        description: 'Read the full text of one memory by id. Only global memory and this working directory\'s memory are visible.',
        parameters: {
            id: { type: 'string', required: true, description: 'Exact memory id returned by `memory_search` or `memory_list`.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    body: { type: 'string', required: true },
                },
            },
            render: (_args, value) => text(`# ${value.title}\n\n${value.body}`),
        },
        async execute(args, exec) {
            const cwd = await deps.resolveCwd(exec);
            const record = await store.get(args.id, cwd);
            return { id: record.id, title: record.title, body: record.body };
        },
    });
    const list = defineTool({
        name: 'memory_list',
        description: 'List memory titles (with ids) for the current working directory and global memory, without reading bodies.',
        parameters: {
            scope: { type: 'string', enum: LIST_SCOPES, description: 'Default `both`.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { entries: { type: 'array', required: true, items: { type: 'string' } } },
            },
            render: (_args, value) => text(value.entries.length === 0 ? 'No memory yet.' : value.entries.join('\n')),
        },
        async execute(args, exec) {
            const cwd = await deps.resolveCwd(exec);
            const records = await store.list(args.scope ?? 'both', cwd);
            return { entries: records.map((record) => describe(record.id, record.title, record.tags, record.scope, record.updatedAt)) };
        },
    });
    const forget = defineTool({
        name: 'memory_forget',
        description: 'Archive one memory so it stops being returned. Archiving is reversible: the Markdown file moves to `.archive/`.',
        parameters: {
            id: { type: 'string', required: true, description: 'Exact memory id.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { archivedPath: { type: 'string', required: true } },
            },
            render: (_args, value) => text(`Archived to ${value.archivedPath}`),
        },
        async execute(args, exec) {
            const cwd = await deps.resolveCwd(exec);
            return { archivedPath: await store.forget(args.id, cwd) };
        },
    });
    return [save, search, get, list, forget];
}
