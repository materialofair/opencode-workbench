---
name: devops-engineer
description: 通过已有 SSH 或本机终端部署和更新 Linux 内部项目，处理 Docker Compose、systemd、nginx、构建、配置校验、健康检查和回滚。用于部署 beobewig、edge store 等内部服务、升级版本、修复发布失败或编写部署脚本。
license: MIT
---

# Linux 项目部署与发布

## 工作流程

1. 阅读目标项目的 AGENTS.md、README、部署脚本和配置文件结构；确认 SSH 别名、主机、用户、环境、项目目录、版本和服务名。不得凭项目名称猜测端口、路径或命令。
2. 先只读检查系统与架构、磁盘/内存、运行时版本、当前进程/容器、监听端口、服务管理方式和依赖连通性。复用现有 SSH 能力；不新增 MCP、代理或常驻服务。
3. 沿用项目已有 Docker Compose、systemd 或其他服务管理方式。普通 Linux 部署不要求引入 Kubernetes、Terraform、GitOps 或新监控平台。
4. 记录当前 commit/镜像摘要、配置备份位置及可执行的回滚步骤。检查工作区修改，避免 git reset --hard 覆盖现场。配置备份保留权限；数据库迁移先确认兼容性、备份和恢复路径，不能把代码回滚当作数据库回滚。
5. 使用项目锁文件与已有构建脚本；先校验构建和配置，再更新服务。用 docker compose config --quiet 校验 Compose，nginx -t 校验 nginx；仅在实际使用对应组件时执行。避免把展开后的含密钥配置输出到会话。
6. 发布前给出简短变更范围、预计中断、验证与回滚步骤，在用户已授权的目标与操作范围内继续；扩大范围或不可逆操作需明确授权。不要重复询问已经明确授权的常规步骤。
7. 仅操作目标服务，避免整机重启、全局清理 Docker、删除卷或修改无关服务。部署应可重复执行，不产生重复进程；避免同时运行两个部署。
8. 发布后检查服务状态、端口、近期错误日志、真实健康/业务接口和 nginx 对外访问路径。接口和预期响应从项目确认；HTTP 200 或进程存在不能独自证明成功。使用有超时、有次数上限的重试，不无限等待。
9. 若验证失败，保存证据并按已确认方案回滚；验证回滚后的服务与业务结果。涉及不兼容数据变更时停止盲目回滚，说明恢复限制。
10. 报告部署版本、实际更改、验证证据和回滚位置；区分“构建成功”“启动成功”和“业务可用”。

## 按需参考

下列资料来自上游，保留原文。仅在任务确实涉及对应技术时读取；示例不是现场可直接执行的命令。以实际项目配置和本入口的 Linux 工作流程为准，不把上游的大型平台实践、自动重启、混沌实验或压测示例作为默认动作。

- [deployment-strategies](references/deployment-strategies.md)
- [docker-patterns](references/docker-patterns.md)
- [github-actions](references/github-actions.md)
- [gitlab-ci](references/gitlab-ci.md)
- [incident-response](references/incident-response.md)
- [kubernetes](references/kubernetes.md)
- [platform-engineering](references/platform-engineering.md)
- [release-automation](references/release-automation.md)
- [terraform-iac](references/terraform-iac.md)

## 来源

改编自 [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/devops-engineer)，MIT；许可证见 [LICENSE](LICENSE)。Workbench 调整了入口描述与流程，参考资料保留上游原文。
