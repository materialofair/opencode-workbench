# 本地验证记录

验证日期：2026-11-01。环境：macOS arm64，Bun 1.2.18，TypeScript 5.9.3，React 19.2.0，OpenCode plugin/SDK/隔离后端 1.19.5。本轮只在隔离项目与测试配置中执行，不修改正在使用的全局 OpenCode/飞书/模型配置。

## 自动化与浏览器

运行 `bun run build`、`bun run typecheck`、`bun test tests`。当前共 23 项测试，0 失败：

| 范围 | 证据 |
| --- | --- |
| 时区与计划 | 上海/纽约、夏令时跳过和每天去重、每周、绝对间隔、规则校验 |
| 持久化与重启 | 独立 SQLite、旧会话核对不重发、丢失提交确认保留待确认 |
| 去重与并发 | 唯一触发 slot、手动幂等键、同任务互斥、全局并发、双实例租约 |
| 异步状态 | 接受不等于完成、审批等待、回答事件、慢查询不覆盖新事件、中止竞争 |
| UI | 真实无头 Chromium：创建、编辑、暂停/启用、立即执行、等待审批、历史、中止、删除、XSS 文本渲染 |
| HTTP | 无 token、错误 Origin、无 CSRF、伪造 Host 被拒绝；无 CORS；CSP 与静态路径白名单 |
| 宿主适配 | 注入 client 的动态地址、认证、directory 保留；ask 与 deny 规则 |
| 飞书模拟 | 固定哈希的适配复现、仅 loopback、模拟认证、缺配置不连接、会话复用/重启查找、/new、Unicode/代码分页 |
| 安装器 | 默认 dry-run、安装/卸载、拒绝覆盖别的文件且先全量预检 |

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

`bun run scan` 对可公开源码、补丁、文档及构建产物扫描，结果无命中。排除项明确为 Git、node_modules、本机安装包装器 `.opencode`、`.data`、artifacts 和日志/运行数据；发布时它们也应保持排除。扫描为启发式，最终公开前仍需人工检查 Git 历史与 staged diff。未配置 remote、未创建公开仓库、未推送或发布 npm。

飞书来源为 NeverMore93/opencode-feishu 1.10.10，MIT，原始版权声明已保留；上游、本地适配和 helper 的哈希已记录。BrowserSkill 不复制或再分发。

## 仍需真实环境验收的项目

- 在当前正在使用的 Desktop 窗口中实际说「打开定时任务管理」、默认浏览器打开页面、Desktop 中逐项批准/拒绝以及关闭项目的完整人工体验。隔离后端已验证工具注册和相同接口，未代替这一项人工验收。
- 真实模型供应商的长任务、断网/睡眠/关机后的端到端行为；自动化只模拟时钟和重启边界，不宣称能唤醒设备。
- 真实飞书机器人长连接、卡片在线更新、权限按钮、附件和发送者授权检查。此次零真实飞书消息，既有连接未迁移。
- Windows/Linux 默认浏览器打开、权限位及桌面安装；目前主要验证 macOS。
- 宿主自动审批模式、第三方工具绕过权限或恶意本机进程不由本插件提供独立沙箱。依赖漏洞审计、外部渗透测试与大规模长期运行尚未进行。

当前预览不支持任意 cron、远端管理、内置审批、自动飞书推送、凭据管理、历史自动归档、多机部署或设备唤醒。这些不是已实现功能。
