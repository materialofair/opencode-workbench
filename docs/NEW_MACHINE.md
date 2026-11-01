# 其他电脑首次部署检查

结论：公开源码可在满足依赖、各自配置模型和平台授权后复用；它不是复制后立即拥有原电脑账号、模型、浏览器登录态的安装包。定时器和管理页无须飞书或 BrowserSkill；两个可选集成必须分别配置。本项目不分发用户配置、模型凭据、会话、任务库或 BrowserSkill 二进制/扩展。

## 先准备什么

| 能力 | 必要条件 | 入口 |
| --- | --- | --- |
| 源码构建 | Git、npm、受支持 Node（CI 22.22.2）、Bun 1.2.18；联网安装锁定依赖 | README 安装步骤 |
| 定时任务 | OpenCode 1.19.5、该项目已可用的模型、支持内置 SQLite 的宿主、本地私人状态目录、默认浏览器 | `scripts/install.ts` |
| 旧任务采集 | Python 3.10+；本人可读、已核实来源的导出文件或 SQLite | `skills/import-scheduled-tasks` |
| 飞书对话 | 自己的机器人、租户权限/事件订阅、私有凭据、明确 owner 项目、已配置模型 | [飞书步骤](FEISHU.md) |
| 浏览器任务 | 独立 BrowserSkill CLI/daemon/扩展均为 0.4.0、本人连接授权、明确实例/来源/动作白名单；飞书入口还需发送者/会话白名单 | [浏览器步骤](BROWSER_FEISHU.md) |

Python 在 Windows 用 `py -3 --version` 核查，Mac/Linux 用 `python3 --version`。受支持 Node 开发依赖范围是 `^22.22.2 || ^24.15.0 || >=26.0.0`；Node 25 即使能跑测试也不满足锁定依赖的声明。Windows 用原生本地 NTFS、用户 ACL 和 PowerShell 路径语法，不能把 WSL 当 Desktop 通过；详见 [Windows](WINDOWS.md)。

## 按层验证

先新建已有的隔离项目目录，按 README 克隆、安装、构建，再 dry-run/apply。保留源码路径；包装器包含该次安装的绝对文件 URL。将源码复制或移动到另一台电脑后，必须在目标机重新安装依赖、构建并生成目标机包装器，不能复制原机 `.opencode` 包装器或状态目录冒充新安装。

1. 在该项目中确认普通 OpenCode 对话能完成；这一步需要自己配置的真实模型，本仓库不会创建模型凭据。
2. 在新宿主实例说「打开定时任务管理」，检查管理页为本机 loopback 页面。先用明确无外部副作用的受控任务验证创建、暂停、历史和执行；审批留在对应宿主会话。
3. 只选择本人确认的旧任务来源。预览不写库，导入全部禁用；核实项目、时区及旧执行者后才选择 Workbench。导入不停止旧任务。不能读取的来源记为未知，复杂规则需要人工评审。
4. 可选飞书按独立步骤配置，由部署者用自己的测试对话确认收发、引用、审批。不要启两个同机器人连接；本审计不发送真实消息。
5. 可选浏览器先由本人检查上游连接及版本，再在 OpenCode 直接验证只读受控页面，最后由本人从飞书验证回传和审批。没有扩展连接不能靠替身测试推断能实际控制浏览器。

## 可重复的隔离验收

在新克隆的源码目录执行（Linux 浏览器系统依赖按 Playwright 官方说明安装）：

```sh
npm ci --ignore-scripts
bun run build
bun run typecheck
bun scripts/prepare-feishu.ts
bunx playwright install chromium
bun test tests
bun run test:integration --installed-project
bun run test:browser-chain
```

最后两项创建自己的临时项目/HOME/配置、loopback 模型；安装模式还验证中文、空格和 `#` 项目路径下包装器的真实发现。测试不会接入真实飞书或模型。浏览器整链使用真实 OpenCode、真实无头 Chromium，飞书 SDK 和 BrowserSkill CLI 是协议替身；会校验四次审批、引用正文、导航/填入/点击/读取/清理和原会话回传。测试成功不是本人真实模型、机器人、扩展已配置成功。

## 本次证据与限制

2026-11-01 从公开 HTTPS 仓库全新克隆基线 `2da0d5b`，没有复用本地源码或 node_modules；在 Mac Apple Silicon 上锁定安装、构建、类型检查、飞书哈希补丁和审计通过。首次完整测试 50 通过、1 项原生 Windows ACL 跳过、0 失败；其中 UI 初次使用已存在的 Playwright 缓存。随后单独下载 Chromium 1194 到临时目录，指定该可执行文件的 UI 再测 1 项通过；真实安装器项目的 OpenCode 完成/审批/中止/重启恢复通过，模型请求 2 次、无重复提交；新浏览器整链成功，四张审批卡、9 次模型请求、owned session 归零。没有真实飞书消息、现用配置或真实云模型参与。

本机 Node 为 25.9.0，npm 明确产生 ini 的 EBADENGINE 警告；安装没有失败，但不能因此声称这是受支持的开发版本。上述依赖说明已补正。受支持 Node 22.22.2 的 Windows Server 2025、Mac、Ubuntu 结果见基线 [CI 41322702816](https://github.com/materialofair/opencode-workbench/actions/runs/41322702816)，三平台均通过。

现有 Mac 连接的引用识别由用户后续确认正常；没有把用户私人消息作为公开测试夹具。历史真实 Mac BrowserSkill/Chrome 受控验证与当前替身整链是两项不同证据。本轮没有改动现用连接或再次运行真实浏览器任务。未完成：另一台实体 Mac 的 Desktop、新 Windows 10/11 Desktop、真实飞书新租户及审批/附件、真实 BrowserSkill Windows 扩展与云模型组成的完整链路、睡眠/关机期间执行。不能承诺任意设备或任意 OpenCode/BrowserSkill 新版本均兼容。

脱敏机器可读证据：[new-machine-macos.json](evidence/new-machine-macos.json)。
