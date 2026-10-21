import z from '@deepseek-ai/schemastery';
import { MemoryStore } from './store.js';
import { createMemoryTools } from './tools.js';
import { renderStanding, selectStanding } from './standing.js';
import { renderPolicy } from './policy.js';
/**
 * Workspace-scoped durable memory for DeepSeek Harness.
 *
 * Mounted at HOST level (see cordis.patch.yml): tools register globally and are
 * visible to every agent, while the standing section is attached to each
 * agent's OWN scope (`agent.ctx`) on `agent/created`, so its contents vary per
 * working directory.
 *
 * Cordis plugin contract: named exports `name`, `inject`, `Config`
 * (schemastery) and `apply(ctx, config)`.
 */
export const name = 'memory-lite';
export const inject = ['tools', 'workingDirectory', 'systemPrompt'];
export const Config = z.object({
    vaultPath: z.string().default(MemoryStore.defaultVaultPath()),
    injectStanding: z.boolean().default(true),
    standingMaxItems: z.number().step(1).min(1).default(8),
    standingBudgetChars: z.number().step(1).min(200).default(1200),
    allowGlobalScope: z.boolean().default(true),
    redactSecrets: z.boolean().default(true),
    maxFileBytes: z.number().step(1).min(1024).default(65_536),
    autoSavePolicy: z.union([z.const('off'), z.const('hint')]).default('off'),
});
export function apply(ctx, config) {
    const store = new MemoryStore({
        vaultPath: config.vaultPath,
        redactSecrets: config.redactSecrets,
        maxFileBytes: config.maxFileBytes,
    });
    const resolveCwd = async (exec) => {
        if (exec.agent === undefined)
            return undefined;
        try {
            return await ctx.workingDirectory.ensure(exec.agent, exec.signal);
        }
        catch {
            return undefined;
        }
    };
    for (const tool of createMemoryTools({ store, resolveCwd, allowGlobalScope: config.allowGlobalScope, defaultLimit: 8 })) {
        ctx.tools.register(tool);
    }
    const policyText = renderPolicy(config);
    if (!config.injectStanding && policyText.length === 0)
        return;
    // `agent/created` is a serial event: the registry awaits every listener before
    // creation resolves, so awaiting here guarantees the sections exist before the
    // agent's first prompt assembly. A failure inside attachSections must never
    // block session creation.
    ctx.on('agent/created', async ({ agent, signal }) => {
        await attachSections(ctx, agent, signal, store, config, policyText);
        return undefined;
    });
}
/**
 * Register the policy hint and the standing title index on the agent's own
 * scope (`agent.ctx.systemPrompt.section`), so they land in that agent's prompt
 * layer and unwind with it. The sections' disposers belong to the agent scope —
 * no host-level bookkeeping needed.
 */
async function attachSections(ctx, agent, signal, store, config, policyText) {
    try {
        if (policyText.length > 0) {
            try {
                agent.ctx.systemPrompt.section({ name: 'memory-lite:policy', order: 401, text: policyText });
            }
            catch {
                /* policy section is best-effort */
            }
        }
        if (!config.injectStanding)
            return;
        const cwd = await ctx.workingDirectory.ensure(agent, signal);
        const globalRecords = await store.list('global');
        const projectRecords = await store.list('project', cwd);
        const entries = selectStanding(globalRecords, projectRecords, config);
        const text = renderStanding(entries, config);
        if (text.length === 0)
            return;
        // dsh-system-prompt's SECTION_ORDERS slots DEPLOYMENT_PERSONA_PREFIX at 0
        // and PLAN_POLICY at 500; 400 keeps the memory index between them, ahead of
        // planning guidance and clear of FILE_REFERENCE at 900.
        agent.ctx.systemPrompt.section({ name: 'memory-lite:standing', order: 400, text });
    }
    catch {
        /* memory must never break session creation */
    }
}
