const HINT = [
    'dsh-memory-lite memory write policy:',
    'proactively call the `memory_save` tool, without waiting for the user to ask, when the user expresses a stable preference or habit, a project decision is settled, an environment fact is confirmed to keep holding in the future, or a pitfall is recorded that will likely recur.',
    'Do not save one-off task state, transient outputs, or facts already readable in the repository or its documentation.',
    'Never save credentials, tokens or secrets in any form.',
    'Default to the `project` scope; use `global` only for facts that hold across every workspace.',
    'When a memory already exists on the same topic, call `memory_forget` first, then `memory_save` (there is no update tool).',
].join(' ');
export function renderPolicy(config) {
    if (config.autoSavePolicy === 'off')
        return '';
    return HINT;
}
