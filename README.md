# OpenCode Workbench

OpenCode 的本机定时任务管理插件，以及可选的飞书 Desktop 适配。React + TypeScript + Node/Bun + SQLite，不修改打包的 OpenCode Desktop，也不另装常驻服务。

对 OpenCode 说「打开定时任务管理」，Skill 调用 `open_task_manager`，默认浏览器打开当前项目的本机页面。页面支持创建、编辑、暂停/启用、删除、立即执行、查看历史及中止运行。

**当前为开发预览版 0.1.0，采用 MIT 许可，不提供 npm 发布包。** 源码目标仓库为 [materialofair/opencode-workbench](https://github.com/materialofair/opencode-workbench)。已验证的内容和未完成的真实环境验收见 [验证记录](docs/VERIFICATION.md)。

**Windows 当前为代码适配预览，尚未完成 Windows 实机/Desktop 端到端验收。** 本机测试在 Mac 执行；云端 Windows Server CI 已通过核心、后端恢复和无头 UI，这仍不等于 Windows 10/11 Desktop 实机验收，详见 [Windows 验证边界](docs/WINDOWS.md)。

## 运行条件

- OpenCode **1.19.5**：兼容 Desktop 的 Node sidecar 与 Bun CLI；SDK 与插件类型均固定到 1.19.5。
- 开发构建使用 Bun 1.2.18 或兼容版本；Desktop 运行使用其已有的 Node SQLite，不要求额外 Bun 常驻进程。Node 运行时需支持 node:sqlite（Node 22.13+）。
- 源码安装还需要 Git、npm 和受支持的 Node；CI 固定 **22.22.2**。锁文件中的 ini 7 要求 `^22.22.2 || ^24.15.0 || >=26.0.0`，Node 25 不满足该开发依赖声明；SQLite 运行下限不是完整开发依赖下限。
- 旧任务只读采集器需要 **Python 3.10+**（macOS/Linux 的 `python3`，Windows 的 `py -3`）；纯管理页面不依赖 Python。
- 本机默认浏览器。每个项目独立页面、数据库与运行会话。
- Windows 10/11 x64 原生环境使用本地 NTFS 状态目录，支持中文和空格路径。Windows 安装、ACL、测试层级及限制见 [Windows 使用说明](docs/WINDOWS.md)；没有用 macOS 上的 Windows 分支测试冒充原生 Windows 验收。
- OpenCode 后端必须在运行。关闭窗口是否退出取决于 Desktop 行为；真正退出后不调度。休眠、关机时不保证准点执行，也不会唤醒设备。

## 安装和使用

先获取源码并在项目目录安装与构建；Windows PowerShell 的完整命令见上方 Windows 说明：

```sh
git clone https://github.com/materialofair/opencode-workbench.git
cd opencode-workbench
npm ci --ignore-scripts
bun run build
bun run typecheck
bunx playwright install chromium
bun test tests
```

UI 测试需要 Playwright Chromium。已有浏览器可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定；否则开发机上按 Playwright 指引安装 Chromium。macOS 缓存会自动探测；其他平台默认使用 Playwright 的浏览器位置。

将插件与 Skill 安装到一个用于试用的 OpenCode 项目：

```sh
bun scripts/install.ts --project /absolute/path/to/test-project
bun scripts/install.ts --project /absolute/path/to/test-project --apply
```

安装器只添加 `.opencode/plugins/workbench-tasks.js`、`.opencode/skills/task-manager/SKILL.md` 与 `.opencode/skills/import-scheduled-tasks/`，不改写 opencode.json、模型配置、权限或现有飞书插件。先输出安装计划；加 `--apply` 才写入。加载一个全新项目实例后对 OpenCode 说「打开定时任务管理」。插件通过带构建哈希的绝对文件 URL 引用此源码目录的 dist/plugin.js，暂勿移动或删除源码。

需要所有项目可发现时用 `--global` 替代 `--project ...`，检查计划后加 `--apply`。这只安装任务管理器；**不会安装或启用第二个飞书连接**。已有同名文件且内容不同会拒绝覆盖。

已被 Desktop 后端加载过的项目可能仍缓存旧插件；网页刷新或关闭标签页不会重建宿主实例。应在其他任务均结束后由本人退出并重新打开 Desktop，或使用明确限定该目录的宿主 instance.dispose；不要为试用直接重启正在承载飞书/其他任务的整个后端。

可先看纯演示页面：

```sh
bun run demo
```

启动链接保存在忽略提交的 `artifacts/demo-url.txt`，由本人在本机浏览器打开。演示没有真实 OpenCode 或飞书执行，进程结束即停止。

## 时间、补跑和权限

- 每天/每周：采用 IANA 时区，例如 `Asia/Shanghai`。夏令时不存在的墙上时间跳过，重复时间同一当地日期只执行一次。
- 固定间隔：1 分钟起，以保存时刻作为绝对时间锚点，不受夏令时影响。
- 单次：输入带 UTC 或明确偏移的 ISO 时间；IANA 时区用于显示。执行后自动停用。
- 错过超过 60 秒视为 misfire。可选择跳过，或在 24 小时内合并补跑最新一次；更旧的不补跑。启用、编辑、保存会重算未来的下一次，**不会补跑编辑前的时刻**。
- 并发最多 2 个，同一任务不重叠；繁忙时记录跳过，不堆积无界队列。
- 每次运行创建新的宿主会话，沿用宿主默认 Agent。模型默认沿用宿主，也可在「本任务模型」填写已配置的 Provider ID 和模型 ID，只影响该任务，不修改全局模型或凭据。设为逐项 `ask`，保留全局及该 Agent 的 `deny`；不修改宿主配置，不默认放行外部操作。审批与问答在 OpenCode 对应会话完成，页面不提供「全部批准」。
- 自动审批模式或其他插件绕过宿主审核的情况不在本插件可保证范围内；不要在这些模式下使用涉及外部副作用的任务。详见 [安全边界](docs/SECURITY.md)。

`已提交` 只表示宿主接受请求；`运行中`、`等待审批`、`等待回答`、`成功`、`失败`、`结果待确认` 分开记录。成功必须有宿主完成消息证据。网络中断、进程崩溃导致结果不明时不自动重发；先在 OpenCode 查验，必要时中止旧运行后手动执行。中止不能撤回已发生的外部操作。

## 飞书与第三方来源

飞书对话能力来自 **[NeverMore93/opencode-feishu](https://github.com/NeverMore93/opencode-feishu)**，固定 `1.10.10`，MIT；本项目不宣称这部分为原创。保留了 [原始许可证](third-party/opencode-feishu/LICENSE)、[来源哈希](third-party/opencode-feishu/provenance.json) 与本地 Desktop 适配补丁。

可选入口、安装迁移、隐私和测试范围见 [飞书适配说明](docs/FEISHU.md)。现有飞书连接用户只安装任务管理器即可；不要同时启用两个相同机器人入口。可选的 [飞书到浏览器整链接入](docs/BROWSER_FEISHU.md) 提供项目专属工具、审批和原创流程 Skill；BrowserSkill 0.4.0 需独立安装，不打包 CLI/扩展或本机私人适配。

## 升级、卸载和数据

升级：在其他工作结束后先用旧源码中的安装器卸载包装器，再退出使用该插件的 OpenCode 后端；备份项目数据库所在目录；在新源码目录重新安装依赖、构建、验证和安装。数据库 schema 当前为 1，不支持自动降级。即使原地更新，也应在修改旧构建或 Skill 前卸载；安装器按原构建哈希与完整内容校验归属，新版本会拒绝直接覆盖旧版本。请保留旧源码及构建，直到卸载和迁移完成。

卸载计划与执行：

```sh
bun scripts/install.ts --project /absolute/path/to/test-project --remove
bun scripts/install.ts --project /absolute/path/to/test-project --remove --apply
```

仅删除安装器内容完全匹配的四个文件（插件包装器、两个 Skill 和采集器）。全局用 `--global --remove`；不会删除其他插件或任何数据库，也不会还原/修改飞书配置。退出后插件停止；卸载不会自动中止已交给宿主执行的会话，请先在页面中止需要停止的运行。

macOS/Linux 数据默认保存在 `${XDG_STATE_HOME:-~/.local/state}/opencode-workbench/<项目真实路径的哈希>/tasks.sqlite`；Windows 默认使用 `%LOCALAPPDATA%/opencode-workbench/<项目路径哈希>/tasks.sqlite`，显式 `XDG_STATE_HOME` 优先。POSIX 目录权限 0700、数据库 0600；Windows 对插件自己的项目状态目录设置当前用户及 SYSTEM 的 ACL，失败则不启动调度，不把 chmod 当成 Windows 访问控制。SQLite 使用 WAL，只支持本地文件系统。退出后一起备份整个项目状态目录，或用 SQLite 在线 backup，勿在运行中单独复制 db 而漏掉 WAL。数据库包含你输入的指令和运行元数据，**不要提交**。删除任务保留历史快照；页面只显示最近 1000 条，当前版本不会自动清理全部历史。

## 开源准备

原创部分采用 MIT，版权署名见根目录 LICENSE。第三方继续保留各自许可证；依赖清单见 [第三方说明](docs/THIRD_PARTY.md)。

```sh
bun run scan
bun run scan:release
```

扫描只报告文件/对象、行号和规则名，不输出匹配密钥。`scan:release` 检查全部本地 Git 对象（含不可达历史）、提交/标签元数据、历史路径与当前 tracked/未忽略文件，完整清单写入不提交的 `artifacts/release-audit.json`。扫描通过并不等于完整安全审计；发布前仍需人工审查 staged diff、私人信息与目标仓库。完整公开范围和许可核查见 [发布准备](docs/RELEASE_PREPARATION.md)。本项目的 GitHub CI 使用隔离 fixture，不读取个人配置、不调用真实模型或飞书、不发布 npm。

原有 5 个高危依赖节点已通过限定升级修复，新锁文件隔离安装的 npm audit 为 0 已知告警；[逐项核查与边界](docs/DEPENDENCY_SECURITY.md)明确区分项目依赖、既有客户端及实际可达性。当前预览版仍未完成生产安全验收。

[架构](docs/ARCHITECTURE.md) · [安全边界](docs/SECURITY.md) · [验证记录](docs/VERIFICATION.md)

## 导入已有定时任务

对 OpenCode 说「只读识别这台电脑已有的定时任务并预览导入」，使用 `import-scheduled-tasks` Skill。先核实实际来源、项目、时区与执行语义，再调用 `import_scheduled_tasks` 工具（默认 dry-run）；管理页也可粘贴统一清单进行预览。支持来源标识、可解释的重复/冲突检测、幂等提交，导入全部禁用且不修改旧调度。启用前须明确选择 Workbench 执行者，核实旧调度避免双重执行。未知插件、复杂 cron、launchd / Windows 执行上下文差异会阻止自动导入，不能把未知当作空任务。详见 [导入接口与转换边界](docs/IMPORT_TASKS.md)。

其他电脑首次部署、依赖检查和分层验收见 [新机器检查清单](docs/NEW_MACHINE.md)。
