# dsh-memory-lite

[English version](README.md)

给 DeepSeek Harness（DSH）用的长期记忆插件，按工作区目录隔离。同一个目录下的会话共享一份记忆；换一个目录默认什么都看不到，只有 `global` 作用域的记忆跨工作区可见。每条记忆就是磁盘上的一个 Markdown 文件：零网络请求、零自动模型调用，没有数据库，也没有索引文件。

## 特性

- 五个工具：`memory_save`、`memory_search`、`memory_get`、`memory_list`、`memory_forget`
- 会话创建时注入一小段「标题索引」常驻系统提示，agent 不必逐个读文件就知道已有哪些记忆
- 以规范化后的工作目录为键做隔离
- 纯 Markdown 加 YAML front matter，任何编辑器都能直接读写
- 忘记即归档，不做物理删除
- 全程零网络，测试套件里有断言保证

## 环境要求

- DSH Desktop 2.0.18，`@deepseek-ai/dsh-*` 0.2.1-rc.2（`engines.dsh` 锁定 `>=0.2.1-rc.2 <0.2.2`）
- `@deepseek-ai/cordis` 4.0.5
- Node.js >= 20
- pnpm（从源码构建时需要）

## 安装

本地目录安装：

```powershell
pnpm install
pnpm build
dsh plugin --profile <name> add <插件目录>
```

或直接从 GitHub 安装：

```powershell
dsh plugin --profile <name> add git+https://github.com/Alexis-ray/dsh-memory-lite.git
```

两种方式都会把插件注册进 `--profile` 指定的 profile（例如 `desktop`），并追加到 `dsh.profile.bundles`。新开会话看不到 `memory_*` 工具就重启客户端。完整的安装、核对、升级与卸载步骤见 [INSTALL.md](INSTALL.md)。

## 工具

| 工具 | 主要入参 | 出参 | 说明 |
|---|---|---|---|
| `memory_save` | `title`（≤80 字符）、`body`、`scope?`（`project` \| `global`）、`tags?`、`confidence?` | `id`、`path`、`scope` | 缺省 `project`；正文像凭证时拒绝写入 |
| `memory_search` | `query`、`scope?`（`both` \| `project` \| `global`）、`limit?` | 命中列表（带片段） | 词法打分：标题×3、标签×2、正文×1，中文按二元组切分；`limit` 缺省 8、上限 50 |
| `memory_get` | `id` | 完整记录 | 找不到就报错，不返回空 |
| `memory_list` | `scope?` | 标题索引行 | 只列标题，不读正文 |
| `memory_forget` | `id` | `archivedPath` | 把文件移进 `.archive/`，移回即恢复 |

`memory_get` 与 `memory_forget` 只能触达当前工作区加 `global` 的记忆；其它工作区的 id 读不到也归档不了。

## 工作区隔离

- 项目键 = `sha256(normalizePath(cwd)).slice(0, 12)`。`normalizePath` 会把盘符转小写、`\` 转 `/`、折叠重复分隔符、去掉末尾分隔符，不解析 symlink；因此改目录名等于换了个新项目。
- 同一目录下的会话共享同一批 project 记忆。
- 换目录后，那些 project 记忆搜不到、按 id 也读不到。
- `global` 记忆所有工作区可见；把 `allowGlobalScope` 设为 `false` 可以禁止写入。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `vaultPath` | `<DSH_HOME>/memory-vault`（未设 `DSH_HOME` 时为 `%USERPROFILE%\.dsh\memory-vault`） | 记忆库根目录 |
| `injectStanding` | `true` | 是否注入常驻标题索引 |
| `standingMaxItems` | `8` | 常驻段最多几条（下限 1） |
| `standingBudgetChars` | `1200` | 常驻段字符预算（下限 200） |
| `allowGlobalScope` | `true` | 是否允许 `memory_save` 写 `global` |
| `redactSecrets` | `true` | 拒绝正文命中凭证模式（`api_key`、`secret`、`password`、`token`、私钥块）的写入 |
| `maxFileBytes` | `65536` | 单条记忆上限（下限 1024） |
| `autoSavePolicy` | `off` | 是否注册「写入策略」系统提示段，提示 agent 主动保存值得记的事实。`hint` 开启，`off` 不注册 |

配置通过 `cordis.patch.yml` 生效：可以用插件自带的那份，也可以在 profile 的 `cordis.patch.yml` 末尾追加 id-targeted patch。没写出的键回落到上表的 schema 默认值。

## 磁盘格式

vault 是个普通目录：

```
<vault>/
  global/
    <slug>-<id>.md            全局记忆，所有工作区可见
  projects/
    <key>/                    key = sha256(normalizePath(cwd)).slice(0, 12)
      project.json            { "path": "<规范化 cwd>", "name": "<目录名>" }
      <slug>-<id>.md          项目记忆，仅该工作区可见
  .archive/
    <slug>-<id>.md            归档（软删除）的记忆
```

一条记忆就是一个带 YAML front matter 的 Markdown 文件：

```markdown
---
id: 20261020-1730-ab12
title: 这个仓库用 pnpm
scope: project
projectPath: c:/work/demo
tags:
  - 工具链
  - 约定
confidence: medium
createdAt: 2026-10-20T09:30:00.000Z
updatedAt: 2026-10-20T09:30:00.000Z
---

装依赖、跑测试、构建一律用 pnpm；不要用 npm 或 yarn，
锁文件是 pnpm-lock.yaml。
```

写入走「临时文件 + fsync + rename」，中途崩溃最多丢这一次写入，不会留下半截文件。超过 `maxFileBytes` 直接拒绝，不静默截断。`memory_forget` 把文件移进 `.archive/` 并补记 `archivedAt`，移回原处即恢复。没有索引文件：列表和检索每次都直接读 `.md` 文件，也就没有需要重建或可能损坏的派生数据。

## 设计取舍

- **永远零网络。** 插件从不外联。`test/offline.test.ts` 在运行时打桩 `fetch`、`http.request`、`https.request`、`net.connect`、`dns.lookup`，并断言调用次数为零。
- **无索引、无数据库。** 一切从文件本身推导。部件更少、无需维护，任何编辑器都能查看 vault。
- **归档而非删除。** 忘记可逆，适合长期记忆。
- **只做词法检索。** 不用 embedding，少假召回，代价是同义词召回弱。
- **常驻段是索引不是内容。** 注入文本明确声明记忆是数据不是指令，正文一律用 `memory_get` 取。
- **编译产物随仓库提交。** 仓库里带 `lib/`，从 git 安装不需要构建步骤。

## 限制

- 词法检索：无语义匹配，同义词召回弱。
- 改项目目录名后，旧记忆留在旧键下（文件还在，`project.json` 记录旧路径）。
- 没有 update 工具：要更新就存一条新的、归档旧的。
- 不做跨机同步；vault 是本地目录，需要同步请自行处理。
- `engines.dsh` 锁窄区间；DSH 升级超出 `>=0.2.1-rc.2 <0.2.2` 后 bundle 会被跳过，先改区间再升级（见 [INSTALL.md](INSTALL.md)）。

## 开发

```powershell
pnpm install      # 装依赖
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # tsc -p tsconfig.json -> lib/
pnpm smoke        # node --experimental-strip-types smoke.mjs
```

`test/offline.test.ts` 会打桩 `fetch`、`http.request`、`https.request`、`net.connect`、`dns.lookup` 后运行整个插件，断言五者一次都没被调用。其余套件覆盖路径规范化与项目键、slug 生成、frontmatter 往返、原子写不留 `.tmp-` 残留、归档、检索排序、跨工作区按 id 拒绝 `get`/`forget`、工具契约，以及常驻段的 3+5 选取与预算裁剪。

## 许可证

[MIT](LICENSE)
