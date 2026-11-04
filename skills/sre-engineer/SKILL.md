---
name: sre-engineer
description: 排查 Linux 内部项目服务不可用、502/504、进程退出、容器重启、OOM、磁盘满和部署后异常；通过 SSH 收集证据、定位原因、恢复服务并验证。需要故障复盘、容量分析或减少重复运维操作时使用。
license: MIT
---

# Linux 服务可靠性与故障处理

## 工作流程

1. 确认受影响主机、服务、时间窗口、用户症状和最近变更；先阅读项目部署说明并确认运行方式。不假设有 Kubernetes 或 Prometheus。
2. 先收集证据再修改：目标进程/容器状态、退出码、重启次数、近期日志、CPU/内存、磁盘容量与 inode、监听端口和依赖连通性。按实际权限使用 systemctl status、journalctl、docker compose ps/logs 等；限定服务、时间范围和输出量。
3. 对 502/504 按客户端 → nginx → 上游端口 → 应用 → 数据库/依赖逐段验证；检查请求时延和超时配置，不能直接把超时调大当作修复。
4. 区分事实、假设和待验证项。每次只验证一个可检验的假设；记录命令、关键结果与下一步。不要用反复重启、kill -9、清空日志或全局清理掩盖原因。
5. 优先采取范围最小、可逆的恢复操作。先说明影响与恢复路径，遵守当前授权；重启单服务前保留故障证据。数据库、卷、备份和未知文件不属于可随意清理的数据。
6. 验证进程、端口、真实接口、错误日志和用户访问链路，并持续观察一个明确的短窗口；如果无法验证外部链路，明确标为未验证。
7. 恢复后给出原因、证据、处理过程及可执行的预防措施。仅在有需求和数据时引入 SLO、容量模型或自动恢复；无数据不编造可用率和根因。
8. 不在排障中自动开展压测、故障注入或混沌实验；这些属于单独限定环境与影响范围的任务。

## 按需参考

下列资料来自上游，保留原文。仅在任务确实涉及对应技术时读取；示例不是现场可直接执行的命令。以实际项目配置和本入口的 Linux 工作流程为准，不把上游的大型平台实践、自动重启、混沌实验或压测示例作为默认动作。

- [automation-toil](references/automation-toil.md)
- [error-budget-policy](references/error-budget-policy.md)
- [incident-chaos](references/incident-chaos.md)
- [monitoring-alerting](references/monitoring-alerting.md)
- [slo-sli-management](references/slo-sli-management.md)

## 来源

改编自 [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/sre-engineer)，MIT；许可证见 [LICENSE](LICENSE)。Workbench 调整了入口描述与流程，参考资料保留上游原文。
