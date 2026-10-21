# dsh-memory-lite

Long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH), scoped by workspace directory. Sessions opened in the same directory share one memory store; sessions in a different directory see none of it, except for memories saved with the `global` scope. Every memory is a plain Markdown file on disk. No network requests, no automatic model calls, no database, no index files.

## Features

- Five tools: `memory_save`, `memory_search`, `memory_get`, `memory_list`, `memory_forget`
- A short "title index" section injected into the system prompt when a session starts, so the agent knows what exists without reading every file
- Workspace isolation keyed by the normalized working directory
- Plain Markdown with YAML front matter; readable and editable in any text editor
- Archive-on-forget instead of deletion
- Zero network activity, asserted by the test suite

## Requirements

- DSH Desktop 2.0.18 with `@deepseek-ai/dsh-*` 0.2.1-rc.2 (`engines.dsh` is pinned to `>=0.2.1-rc.2 <0.2.2`)
- `@deepseek-ai/cordis` 4.0.5
- Node.js >= 20
- pnpm (for building from source)

## Install

From a local checkout:

```powershell
pnpm install
pnpm build
dsh plugin --profile <name> add <path-to-repo>
```

Or directly from GitHub:

```powershell
dsh plugin --profile <name> add git+https://github.com/Alexis-ray/dsh-memory-lite.git
```

Both forms register the plugin in the profile named by `--profile` (for example `desktop`) and append `dsh-memory-lite` to `dsh.profile.bundles`. Restart the client if a newly created session does not see the `memory_*` tools. Full instructions, including verification, upgrade, and uninstall, are in [INSTALL.md](INSTALL.md) (Chinese).

## Tools

| Tool | Key inputs | Returns | Notes |
|---|---|---|---|
| `memory_save` | `title` (<= 80 chars), `body`, `scope?` (`project` \| `global`), `tags?`, `confidence?` | `id`, `path`, `scope` | Defaults to `project`. Rejects bodies that look like credentials. |
| `memory_search` | `query`, `scope?` (`both` \| `project` \| `global`), `limit?` | hit list with snippets | Lexical scoring: title x3, tags x2, body x1. CJK text is matched as bigrams. Default limit 8, max 50. |
| `memory_get` | `id` | full record | Errors when not found; never returns empty. |
| `memory_list` | `scope?` | title index lines | Titles only; bodies are not read. |
| `memory_forget` | `id` | `archivedPath` | Moves the file to `.archive/`; reversible by moving it back. |

`memory_get` and `memory_forget` only reach memories visible to the current workspace plus `global`; an id from another workspace cannot be read or archived.

## Workspace isolation

- The project key is `sha256(normalizePath(cwd)).slice(0, 12)`. `normalizePath` lowercases the drive letter, converts `\` to `/`, collapses repeated separators, and drops the trailing separator. Symlinks are not resolved, so renaming a directory means a new project.
- Sessions in the same directory share the same set of project memories.
- Sessions in a different directory cannot see, search, get, or forget those project memories, even by id.
- `global` memories are visible from every workspace. Set `allowGlobalScope: false` to disable writing them.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `vaultPath` | `<DSH_HOME>/memory-vault` (or `%USERPROFILE%\.dsh\memory-vault` when `DSH_HOME` is unset) | Root directory of the vault |
| `injectStanding` | `true` | Inject the standing title index into the system prompt |
| `standingMaxItems` | `8` | Max entries in the standing section (min 1) |
| `standingBudgetChars` | `1200` | Character budget for the standing section (min 200) |
| `allowGlobalScope` | `true` | Allow `scope: global` in `memory_save` |
| `redactSecrets` | `true` | Reject writes whose body matches credential patterns (`api_key`, `secret`, `password`, `token`, private key blocks) |
| `maxFileBytes` | `65536` | Max size of a single memory file (min 1024) |
| `autoSavePolicy` | `off` | Whether to register a "write policy" system prompt section that nudges the agent to save notable facts proactively. `hint` enables the section; `off` registers nothing. |

Values are set through the plugin's config in `cordis.patch.yml` (either the file shipped with the plugin, or an id-targeted patch appended to your profile's `cordis.patch.yml`). Keys that are not written fall back to the schema defaults above.

## On-disk format

The vault is a plain directory:

```
<vault>/
  global/
    <slug>-<id>.md            global memories, visible everywhere
  projects/
    <key>/                    key = sha256(normalizePath(cwd)).slice(0, 12)
      project.json            { "path": "<normalized cwd>", "name": "<dir name>" }
      <slug>-<id>.md          project memories, visible in that workspace only
  .archive/
    <slug>-<id>.md            archived (soft-deleted) memories
```

One memory is one Markdown file with YAML front matter:

```markdown
---
id: 20261020-1730-ab12
title: This repo uses pnpm
scope: project
projectPath: c:/work/demo
tags:
  - toolchain
  - conventions
confidence: medium
createdAt: 2026-10-20T09:30:00.000Z
updatedAt: 2026-10-20T09:30:00.000Z
---

Install dependencies, run tests, and build with pnpm. Do not use npm or
yarn; the lockfile is pnpm-lock.yaml.
```

Writes go through a temp file plus fsync plus rename, so a crash mid-write loses at most that one write and never leaves a truncated memory file. Files over `maxFileBytes` are rejected outright, not truncated. `memory_forget` moves the file into `.archive/` and stamps `archivedAt`; moving it back restores it. There is no index file: listing and search always read the `.md` files directly, so there is nothing to rebuild or corrupt.

## Design trade-offs

- **No network, ever.** The plugin never calls out. `test/offline.test.ts` stubs `fetch`, `http.request`, `https.request`, `net.connect`, and `dns.lookup` at runtime and asserts zero call attempts.
- **No index, no database.** Everything is derived from the files themselves. Fewer moving parts, nothing to maintain, and any editor can inspect the vault.
- **Archive, don't delete.** Forgetting is reversible, which suits long-lived memories.
- **Lexical search only.** No embeddings. Fewer false recalls at the cost of missing synonyms.
- **Standing section is an index, not content.** The injected text says memories are data, not instructions, and bodies must be fetched with `memory_get`.
- **Built output is committed.** `lib/` ships in the repository so the plugin can be installed straight from git without a build step.

## Limitations

- Lexical search: no semantic matching, weak on synonyms.
- Renaming a project directory orphans its memories under the old key (they remain on disk; `project.json` records the old path).
- No update tool: replace a memory by saving a new one and forgetting the old.
- No cross-machine sync; the vault is a local directory, sync it yourself if needed.
- `engines.dsh` is pinned to a narrow range; a DSH upgrade outside `>=0.2.1-rc.2 <0.2.2` skips the bundle until the range is updated (see [INSTALL.md](INSTALL.md)).

## Development

```powershell
pnpm install      # install dependencies
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsc -p tsconfig.json -> lib/
pnpm smoke        # node --experimental-strip-types smoke.mjs
```

`test/offline.test.ts` runs the entire plugin with `fetch`, `http.request`, `https.request`, `net.connect`, and `dns.lookup` stubbed, and asserts that none of them was called even once. The other suites cover path normalization and project keys, slug generation, frontmatter round-trips, atomic writes leaving no `.tmp-` residue, archiving, search ranking, cross-workspace denial of `get`/`forget` by id, the tool contracts, and the standing section's 3+5 selection and budget trimming.

## License

[MIT](LICENSE)

---

Read this page in Chinese: [README.zh-CN.md](README.zh-CN.md)
