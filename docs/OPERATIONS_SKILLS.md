# Linux 运维 Skills

用于已有 SSH 或本机 Shell 执行能力的 OpenCode。仅补充按需加载的运维流程，不增加执行权限或工具，也不自动部署任何项目。三个入口均提供中文触发描述，保留上游完整参考资料，来源与许可见 [第三方声明](THIRD_PARTY.md)。

## 安装位置

在 OpenCode 后端运行的机器上，从 Workbench 源码目录执行：

```sh
bun scripts/install-ops.ts --project /absolute/path/to/project
bun scripts/install-ops.ts --project /absolute/path/to/project --apply
```

项目目录必须存在。Windows 可使用 `C:/Code/My Project` 并用引号包裹；安装器使用跨平台路径 API，拒绝符号链接/junction。Skill 被复制到目标项目的 `.opencode/skills/`，不依赖源码目录继续存在，也不需要 `bun run build`。Bun 仅用于运行安装脚本。

所有项目共用时，使用 `--global` 替代 `--project ...`；目标为 `${XDG_CONFIG_HOME:-~/.config}/opencode/skills/`。应安装到实际运行 OpenCode 的用户账户。SSH 远端只承载被管理服务时，不需要再往远端安装这些 Skill。

`--apply` 前默认只输出计划。所有目标在写入前完成冲突校验；同内容可重复安装，内容不同则停止且不写入其他 Skill。选择一个作用域，避免项目和全局安装不同版本造成遮蔽。

安装后在新 OpenCode 会话中要求使用对应 Skill，检查是否能加载入口和参考文件。仓库内 `skills/` 是分发来源，单独拉取仓库不会把它们安装到其他项目。

## 示例任务

- 「使用 devops-engineer，通过已有 SSH 部署 beobewig，先识别当前部署方式，给出更新与回滚步骤，最后验证真实接口。」
- 「使用 sre-engineer，检查 edge store 的 502，先收集日志、端口和上游服务证据，不要直接重启碰运气。」
- 「使用 monitoring-expert，检查该服务器最近一小时的应用错误和资源瓶颈，给出证据和建议。」

Skills 不包含任何真实主机、用户名、端口、项目路径或凭据。目标项目的 AGENTS.md/部署说明应提供：SSH 别名、部署目录、构建/启动命令、服务名、配置文件位置（不写密钥）、健康接口、预期响应与回滚方式。未知项由 Agent 先只读识别，必要时询问，不根据项目名称猜测。

## 运维约定

- 沿用现有 Compose/systemd/nginx，不默认引入 K8s、Terraform 或新监控平台。
- 先读取现场信息，保留配置与版本恢复点，避免覆盖未提交改动。
- 发布后同时检查进程、端口、错误日志、真实接口和对外链路。
- 故障排查先证据后操作，不把自动重启、全局清理、压测作为默认修复。
- 沿用用户已有授权；扩大操作范围、不可逆变更需先明确授权。
- 这些是模型指令，不是权限隔离机制；执行权限仍由已有 OpenCode/SSH 配置控制。

## 更新与卸载

使用旧版本源码先卸载，再更新仓库并重新安装，避免覆盖用户定制文件：

```sh
bun scripts/install-ops.ts --project /absolute/path/to/project --remove
bun scripts/install-ops.ts --project /absolute/path/to/project --remove --apply
```

全局使用 `--global --remove --apply`。只删除与安装来源内容完全匹配的文件；任一文件被修改则停止，先备份并核对差异。用户额外添加的文件和空目录保留。不会卸载任务管理器、飞书或浏览器插件。

## 验证边界

自动测试覆盖安装、重复安装、完整参考文件复制、冲突预检、符号链接拒绝、全局路径及可逆卸载。它们不等于实际服务器部署或模型行为验收；本次集成不会连接内部服务器。
