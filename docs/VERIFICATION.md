# 本地验证记录

验证日期：2026-11-01。环境：macOS arm64，Bun 1.2.18，TypeScript 5.9.3，React 19.2.0，OpenCode plugin/SDK/隔离后端 1.19.5。早期在隔离项目与测试配置中执行，后续在 Default Project 做了最小增量安装；未修改全局 OpenCode/飞书/模型配置，详见下方部署记录。

## 自动化与浏览器

运行 `bun run build`、`bun run typecheck`、`bun test tests`。隔离的新依赖副本在本机 macOS 当前共 33 项：32 通过、1 项仅限原生 Windows 的实际 ACL 检查跳过，0 失败。新增 Windows 分支测试不等于 Windows 真机通过；CI 结果另见 [Windows 说明](WINDOWS.md)。

| 范围 | 证据 |
| --- | --- |
| 时区与计划 | 上海/纽约、夏令时跳过和每天去重、每周、绝对间隔、规则校验 |
| 持久化与重启 | 独立 SQLite、旧会话核对不重发、丢失提交确认保留待确认 |
| 去重与并发 | 唯一触发 slot、手动幂等键、同任务互斥、全局并发、双实例租约 |
| 异步状态 | 接受不等于完成、审批等待、慢查询不覆盖新事件、中止竞争 |
| UI | 真实无头 Chromium：创建、编辑、暂停/启用、立即执行、等待审批、历史、中止、删除、XSS 文本渲染 |
| HTTP | 无 token、错误 Origin、无 CSRF、伪造 Host 被拒绝；无 CORS；CSP 与静态路径白名单 |
| Node 运行时 | 编译后的真实插件在 Node 中完成 SQLite CRUD、HTTP 鉴权、注入 client 的执行与成功终态 |
| 宿主适配 | 注入 client 的动态地址、认证、directory 保留；ask 与 deny 规则 |
| 飞书模拟 | 固定哈希的适配复现、仅 loopback、模拟认证、缺配置不连接、会话复用/重启查找、/new、Unicode/代码分页 |
| 安装器 | 默认 dry-run、中文/空格路径安装卸载、拒绝覆盖别的文件、拒绝符号链接/junction，先全量预检 |
| Windows 分支 | drive/slash/case/长路径身份、LocalAppData/XDG、浏览器参数、ACL fail-closed、SDK 目录编码；原生 ACL 在 macOS 明确跳过 |
| Windows 实测修复 | Bun SQLite 显式 finalize/严格关闭，验证关闭后立即重命名再打开；Playwright UI 在 Desktop 同类 Node 运行时执行 |

截图保存在忽略提交的 `artifacts/task-manager-desktop.png`、`task-manager-approval.png`、`task-manager-mobile.png`，展示的均为模拟项目和任务。无真实对话或凭据。Skill 通过本机 skill-creator 的 frontmatter/name 校验；这是 OpenCode 仓库配套 Skill，不是 ChatGPT 个人技能安装。

## 真实 OpenCode 后端接口

`bun run test:integration` 启动新 HOME、XDG 目录与独立端口的真实 1.19.5 后端，模型是本机 deterministic SSE fixture；没有真实模型密钥，不接入飞书。

已验证：

1. 后端确实注册 `open_task_manager` 工具。
2. 新会话持久化 ask 和宿主/Agent deny 规则。
3. 异步提交通过本机模拟模型完成，并凭完成消息核对为 `succeeded`。
4. fixture 产生工具调用，宿主真实发出 `permission.asked`，运行记录为 `waiting_approval`；未批准命令。
5. 中止通过真实宿主 abort，记录 `interrupted`。
6. 杀死并重启同一隔离后端，插件从其真实 SQLite 恢复已提交会话为成功；模型请求总数仍为 2，没有重发。

脱敏结果见 [OpenCode 1.19.5 集成证据](evidence/opencode-1.19.5.json)。隔离进程均已停止；测试目录在 OS 临时目录，不进入 Git。

## 敏感信息与来源

`bun run scan` 对可公开源码、补丁、文档及构建产物扫描，结果无命中。排除项明确为 Git、node_modules、本机安装包装器 `.opencode`、`.data`、artifacts 和日志/运行数据；发布时它们也应保持排除。`bun run scan:release` 另检查完整 Git 对象库、历史路径及提交元数据。扫描为启发式，不能代替人工审查；公开范围见 [发布准备](RELEASE_PREPARATION.md)。不发布 npm。

飞书来源为 NeverMore93/opencode-feishu 1.10.10，MIT，原始版权声明已保留；上游、本地适配和 helper 的哈希已记录。BrowserSkill 不复制或再分发。

## 现用 Desktop 验收

补充的现用 Desktop 验收已经完成，见 [完整事实与边界](DESKTOP_ACCEPTANCE.md)。它发现并修复了 Node sidecar 与 Bun CLI 的运行时差异；真实 Skill/专用工具/Comet 页面、单次触发、固定回复成功、页面中止、项目插件实例重建后去重均已验证。

## Default Project 部署验收

已完成日常 Default Project 的空闲检查、最小增量安装、按目录重建、Skill/工具/页面唤起及真实单次任务完成，见 [Default Project 部署记录](DEFAULT_PROJECT_DEPLOYMENT.md)。既有飞书插件认证读取与初始化通过；未发送真实消息。

## 仍需真实环境验收的项目

- 整个 Desktop/其后端进程退出重启尚未对正在使用的实例执行，以免中断既有飞书和其他任务。现用实例已验证按目录限定的插件实例重建；完整进程崩溃/重启由隔离后端脚本覆盖。
- 现用 Desktop 的逐项权限按钮批准/拒绝尚未额外执行；真实后端 permission.asked 和管理页等待由隔离集成脚本验证。
- 真实模型供应商的长任务、断网/睡眠/关机后的端到端行为；自动化只模拟时钟和重启边界，不宣称能唤醒设备。
- 真实飞书机器人长连接、卡片在线更新、权限按钮、附件和发送者授权检查。此次零真实飞书消息，既有连接未迁移。
- Windows/Linux Desktop 真实界面、默认浏览器实际唤起和飞书实际连接；本机没有 Windows 环境，跨平台分支测试与 CI 不能代替这些验收。
- 宿主自动审批模式、第三方工具绕过权限或恶意本机进程不由本插件提供独立沙箱。npm audit 原有告警已限定升级并在干净安装验证为 0，详见 [逐项核查](DEPENDENCY_SECURITY.md)；完整依赖安全审计、外部渗透测试与大规模长期运行尚未完成。

当前预览不支持任意 cron、远端管理、内置审批、自动飞书推送、凭据管理、历史自动归档、多机部署或设备唤醒。这些不是已实现功能。
