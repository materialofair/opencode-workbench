---
name: import-scheduled-tasks
description: 只读识别这台电脑已有的 OpenCode 定时任务，预览冲突并导入 Workbench 管理界面。用于导入或迁移 cron、launchd、Windows 计划任务、旧 Workbench 或已知调度插件的任务。
---

先核实来源，再调用当前项目的 `import_scheduled_tasks`。工具缺失时说明插件尚未加载，参考项目 README；不要另启 OpenCode 后端或猜测端口。

只读发现，不假定调度器：

- macOS：检查用户/系统 LaunchAgents、LaunchDaemons 的标签和直接执行目标；只进一步读取确认相关的 plist / 包装脚本。读取 crontab 需遵守当前工具权限。不能读取时记录“未知”，不视作不存在。不要用 sudo、改变系统设置、停止任务或提升持续访问。
- Windows：只读枚举 Task Scheduler 的任务名、执行目标；仅导出确认相关的任务 XML。保留未知状态和执行身份差异，不读取无关任务正文。
- 检查 OpenCode 已启用插件的名称和调度相关配置键；不要转储 provider、环境变量、账号、token、认证文件、会话数据库或日志。对未知插件先查其实现/文档和实际存储，再编写适配；普通 todo、日历事件或示例配置不算定时任务。
- 检查 Workbench 项目状态库（`XDG_STATE_HOME/opencode-workbench`，默认 macOS/Linux `~/.local/state/opencode-workbench`，Windows `%LOCALAPPDATA%/opencode-workbench`）；Desktop 的 XDG 目录可能位于其应用数据下。只读选中的 tasks 表，不读取 runs 或会话内容。目录名为项目路径哈希，不能反推出项目；必须用配置/已知项目验证归属，不能把所有库映射到当前项目。

先报告来源覆盖、无法访问处、规则/项目/提示词/时区/原状态是否可验证。报告仅用计数和脱敏标识。采集器摘要不输出提示词，完整清单使用本机私人文件；通过宿主模型读取或传参时仍遵循其数据策略，清单不得包含凭据。不要把任务数据、原始导出、prompt 或 token 提交到源码或上传。

收集已确认来源可运行本 Skill 的 `scripts/collect.py`：

```sh
python3 scripts/collect.py --kind workbench --path /private/local/tasks.sqlite --project /verified/project
python3 scripts/collect.py --kind cron --path /private/local/selected.crontab --project /verified/project --timezone Asia/Shanghai
```

脚本路径相对于本 Skill 目录；Windows 可用 `py -3`。默认仅输出调度元数据。`--output /private/local/import.json` 才以独占创建方式保存含提示词的清单；在 Windows 选择当前用户私有且 ACL 受保护的目录。`--source-id` 使用稳定、非敏感标识，每次复用。`--task-id` 可选中任务；cron 当前按行号标识，重排会变更 ID，仍有内容去重。只读取明确选择的文件。脚本不会调用 shell 或调度器，也不会创建缺失源库。

收集器对不支持规则与执行上下文给出 `issues`，必须逐项核实，不得直接删除这些标记。普通 cron 的 DST/补跑行为取决于实际实现；先说明目标规则为“不存在时间跳过，重复日期只执行一次，错过默认跳过”，需要用户确认差异时保持未导入。launchd 的补跑、额外触发、环境依赖以及 Windows 参数、权限、条件不能自动等同；需要核实后生成结构化清单。未知时区不自动替换为当前时区。包装脚本、远程执行、持久会话、附加文件及非默认 agent 不能只截取 prompt 后当作等价任务。

统一清单使用以下结构（仅示意，实际数据留在本机）：

```json
{"version":1,"sources":[{"kind":"plugin","id":"stable-source","tasks":[{"id":"original-task-id","project":"/verified/project","name":"Read-only summary","prompt":"Summarize fixture files without changes","timezone":"Etc/UTC","schedule":{"kind":"daily","time":"09:00","weekdays":[1,2,3,4,5]},"enabled":"unknown"}]}]}
```

source.kind 支持 `workbench`、`cron`、`launchd`、`windows-task`、`plugin`；enabled 为原状态 true/false/unknown。时间规则支持 daily、interval（minutes）、once（带 UTC/偏移的 at）；可携带已有 providerID/modelID，不保存凭据。每批最多 100 条、清单 64 KiB。导入仅限当前项目；路径不能跨机器自动映射。模型必须在目标宿主实际可用，未知配置不猜测。

调用工具，manifest 为 JSON 字符串，dryRun=true。向用户解释 ready/duplicate/conflict/unsupported、来源状态和迁移差异；不要回显 prompt。工具不会读取源文件。来源 ID 相同但内容改变时不会覆盖，跨来源相同内容跳过，相似名称/内容需人工核实。先排除或解决冲突，再重新预览；不要改来源 ID 绕过去重。

用户已要求导入且预览无未解决问题时，以相同清单、返回的 preview 指纹及 dryRun=false 提交。用户仅要求扫描/预览时，不提交。预览过期则重做 dry-run；超时重试相同清单不会重复创建。整批提交原子完成，默认禁用、执行者未选定。

最后调用 `open_task_manager` 展示结果。明确导入不接管或关闭原调度，真正启用或立即运行前须在页面选择 Workbench 执行者并核实重复执行风险。未经单独授权，不停止、删除或修改任何原任务。不能把导入成功说成后台常驻或保证唤醒；任务随当前 OpenCode 后端运行。
