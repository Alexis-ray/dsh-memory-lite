# dsh-memory-lite 安装指南（Windows / PowerShell）

面向读者：要在自己的 DSH Desktop 环境里安装本插件的用户。按顺序执行即可，每步都带核对方法。全文用 `<插件目录>` 指代本仓库的本地路径，`<profile>` 指代目标 profile 名，`<DSH_HOME>` 指代 DSH 的数据目录（默认 `%USERPROFILE%\.dsh`）。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 客户端 | DSH Desktop app 2.0.18 |
| DSH 核心包 | `@deepseek-ai/dsh-*` 0.2.1-rc.2（`engines.dsh` 锁定 `>=0.2.1-rc.2 <0.2.2`） |
| cordis | `@deepseek-ai/cordis` 4.0.5 |
| 系统 | Windows，Node ≥ 20，pnpm 可用 |
| 仓库位置 | 任意本地目录，下文记作 `<插件目录>` |

## 2. 构建（本地目录安装时）

```powershell
cd <插件目录>
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 产出 `lib/`。运行时入口是 `lib/index.js`：`package.json` 的 `main` 与 `exports` 都指向它，host 加载插件时执行的就是这份产物。从 git 直接安装时仓库已带编译好的 `lib/`，可跳过本节。

## 3. 安装到 profile

**建议先完全退出 DSH Desktop（含托盘退出）再安装。** 不退出时插件也可能被热重载直接加载，但 profile 变更走稳妥路径更好：没退出就装的话，装完按第 5 节确认新会话能否看到工具，看不到再重启。

```powershell
dsh plugin --profile <profile> add "<插件目录>"
```

或从 GitHub 安装：

```powershell
dsh plugin --profile <profile> add git+https://github.com/Alexis-ray/dsh-memory-lite.git
```

说明：

- `dsh plugin` 会转发给 profile 目录里的 pnpm 完成依赖安装；因为包声明了 `dsh.bundle.patch`（指向 `cordis.patch.yml`），它同时把 `dsh-memory-lite` 追加到 `dsh.profile.bundles` 末尾。
- 本地目录以 `link:` 依赖安装，后续 `pnpm build` 出的新产物直接生效，不必重新 add。

`dsh` 不在 PATH 时，用客户端自带的 CLI 直连（路径按实际安装位置调整）：

```powershell
$exe  = '<DSH Desktop 安装目录>\DSH Desktop.exe'
$cli  = '<DSH Desktop 安装目录>\resources\app\lib\desktop-cli.js'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_HOME = '<DSH_HOME>'
& $exe --expose-internals $cli plugin --profile <profile> add "<插件目录>"
```

## 4. 核对安装

读 `<DSH_HOME>\profiles\<profile>\package.json`，核对两个要点：

- `dependencies` 新增 `"dsh-memory-lite": "link:<插件目录>"`（git 安装时是 git 依赖）；
- `dsh.profile.bundles` 的最后一项是 `"dsh-memory-lite"`，之前的条目保持不变。

```json
"dependencies": {
  "dsh-memory-lite": "link:<插件目录>"
},
"dsh": {
  "profile": {
    "bundles": [
      "...已有条目保持原样...",
      "dsh-memory-lite"
    ]
  }
}
```

`dsh --profile <profile> --dump-config` 的合成树应包含 `# == dsh-memory-lite`、`- id: memory-lite`、`name: dsh-memory-lite` 三处。profile 的 `cordis.patch.yml` 不需要手改，插件自带 patch 已完成挂载。

## 5. 首次使用与验收

1. 新开一个会话（旧会话不会补挂新工具）。如果新会话看不到 `memory_*` 工具，重启 DSH Desktop。
2. 让 agent 分别写一条 project 和一条 global 记忆，例如：
   - 「用 memory_save 记一条 project 记忆：标题"工作区约定：包管理器"，正文"本仓库用 pnpm，不要用 npm"，标签 pnpm、构建。」
   - 「用 memory_save 记一条 global 记忆：标题"交付物偏好"，正文"交付前先转 PDF"。」
3. 在同一个目录再开一个新会话验证：
   - 「用 memory_search 搜 pnpm，应该命中刚才的 project 记忆。」
   - 「用 memory_get 读那条记录的全文。」
4. 换一个目录开新会话验证隔离：
   - 「用 memory_search 搜 pnpm」应搜不到 project 记忆。
   - 「用 memory_search 搜 交付」能搜到 global 记忆。

## 6. 配置项覆盖

默认 vault 是 `<DSH_HOME>/memory-vault`。要换位置或改其它配置，在 `<DSH_HOME>\profiles\<profile>\cordis.patch.yml` 末尾追加 id-targeted patch：

```yaml
- id: memory-lite
  config:
    vaultPath: 'D:\some\dir\memory-vault'
```

说明：这种 patch 会整体替换 `memory-lite` 那一行的 `config`；没有写出的键回落到 Config 的 schema 默认值，所以只写 `vaultPath` 是安全的。全部可用键见 README 的配置表。

## 7. 数据落盘位置

默认 vault 在 `<DSH_HOME>\memory-vault`：

```
memory-vault/
  global/<slug>-<id>.md            全局记忆
  projects/<sha256(cwd)[:12]>/     项目记忆 + project.json
  .archive/                        forget 归档（软删除）
```

全部是纯 Markdown，没有索引文件，换任何编辑器都能直接读。

## 8. 卸载

先完全退出 DSH Desktop，然后：

```powershell
dsh plugin --profile <profile> remove dsh-memory-lite
```

核对 `<DSH_HOME>\profiles\<profile>\package.json`：`dependencies` 和 `dsh.profile.bundles` 都不再有 `dsh-memory-lite`，再重启客户端。

vault 不会被删。要彻底清除，手动删掉 `<DSH_HOME>\memory-vault` 即可（普通 Markdown，无残留注册）。

`remove` 失败时手工回滚：编辑 `package.json` 删掉 dependencies 里的条目和 bundles 里的条目，然后：

```powershell
dsh plugin --profile <profile> install
```

再重启客户端。

## 9. 风险与注意事项

- 安装/卸载会触发热重载，可能让当前会话的 `pwsh`、`read` 等工具变成 unknown。若新会话看不到工具或当前会话工具异常，重启客户端即可恢复。
- `vaultPath` 不要指向存放其它语料的旧目录，vault 必须是本插件独占的空目录或新目录。
- **DSH 升级超出 `engines.dsh` 区间（`>=0.2.1-rc.2 <0.2.2`）后，bundle 会被跳过并打印 `skipping profile bundle`。** 需要同步修改 `package.json` 里的 `engines.dsh` 与 `peerDependencies` 四个 `@deepseek-ai/dsh-*` 的版本，重新 `pnpm install && pnpm build`，再执行一次第 3 步的 plugin add。
- 卸载后 vault 仍是普通 Markdown 目录，插件不留下任何注册残留。
- pnpm 安装时打印的 `Issues with peer dependencies found` 警告可忽略：这些 peer（`@deepseek-ai/*`）由 DSH 安装目录在运行时解析。
