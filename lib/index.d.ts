import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
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
export declare const name = "memory-lite";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    vaultPath: z<string, string, "defined">;
    injectStanding: z<boolean, boolean, "defined">;
    standingMaxItems: z<number, number, "defined">;
    standingBudgetChars: z<number, number, "defined">;
    allowGlobalScope: z<boolean, boolean, "defined">;
    redactSecrets: z<boolean, boolean, "defined">;
    maxFileBytes: z<number, number, "defined">;
    autoSavePolicy: z<"off" | "hint", "off" | "hint", "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    vaultPath: z<string, string, "defined">;
    injectStanding: z<boolean, boolean, "defined">;
    standingMaxItems: z<number, number, "defined">;
    standingBudgetChars: z<number, number, "defined">;
    allowGlobalScope: z<boolean, boolean, "defined">;
    redactSecrets: z<boolean, boolean, "defined">;
    maxFileBytes: z<number, number, "defined">;
    autoSavePolicy: z<"off" | "hint", "off" | "hint", "defined">;
}>>, "plain">;
export interface MemoryLiteConfig {
    vaultPath: string;
    injectStanding: boolean;
    standingMaxItems: number;
    standingBudgetChars: number;
    allowGlobalScope: boolean;
    redactSecrets: boolean;
    maxFileBytes: number;
    autoSavePolicy: 'off' | 'hint';
}
export declare function apply(ctx: Context, config: MemoryLiteConfig): void;
