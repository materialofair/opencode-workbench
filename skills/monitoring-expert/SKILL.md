---
name: monitoring-expert
description: 分析 Linux 内部服务日志、CPU/内存/磁盘和请求错误，配置轻量健康检查、日志轮转与可执行告警。用于 SSH 巡检、nginx/应用日志分析、性能瓶颈和容量评估；已有 Prometheus/Grafana 时复用其指标。
license: MIT
---

# Linux 日志、指标与健康检查

## 工作流程

1. 从用户症状与已有观测能力出发：确认主机、服务、时间窗口、时区、访问路径和关键接口。复用 journalctl、Docker 日志、nginx 日志或已有监控系统，不为查一次日志部署整套平台。
2. 有界收集信息：限制时间、行数、查询范围和命令执行时间。日志与配置可能包含凭据和个人数据，先筛选与脱敏，不输出完整环境变量、.env、私钥或整份数据库连接配置。
3. 联合检查请求速率、错误率、延迟与 CPU/内存/磁盘/inode/连接数；区分平均值与峰值，分母为零或缺数据时标为未知，不能当作健康。
4. 将同一请求 ID、时间窗口和变更记录关联起来。区分资源不足、应用异常、依赖超时和代理问题，给出证据及仍待验证的假设。
5. 健康检查使用已确认的真实接口、合理超时、重试上限与预期响应；区分进程存活和业务就绪。不要为了探测触发下单、删除等业务写操作。
6. 改日志配置先备份并校验，使用现有日志轮转/保留策略；排查磁盘满先定位占用，不能直接截断日志或删除容器卷。
7. 只对可采取行动的异常配置告警，设置持续窗口、恢复条件、接收渠道与处理步骤。未经请求不发送外部通知。
8. 性能分析优先低开销观测；压测、长时间 profiling 或新采集代理需作为独立任务明确目标、开销和授权。指标标签使用归一化路由，不用用户 ID、请求 ID 或原始 URL 等高基数字段。
9. 输出带时间范围的观测结果、证据、建议和验证方法，明确哪些数据缺失。

## 按需参考

下列资料来自上游，保留原文。仅在任务确实涉及对应技术时读取；示例不是现场可直接执行的命令。以实际项目配置和本入口的 Linux 工作流程为准，不把上游的大型平台实践、自动重启、混沌实验或压测示例作为默认动作。

- [alerting-rules](references/alerting-rules.md)
- [application-profiling](references/application-profiling.md)
- [capacity-planning](references/capacity-planning.md)
- [dashboards](references/dashboards.md)
- [opentelemetry](references/opentelemetry.md)
- [performance-testing](references/performance-testing.md)
- [prometheus-metrics](references/prometheus-metrics.md)
- [structured-logging](references/structured-logging.md)

## 来源

改编自 [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/078a25cc5bfd8011459be7b91d004e900c1d02d3/skills/monitoring-expert)，MIT；许可证见 [LICENSE](LICENSE)。Workbench 调整了入口描述与流程，参考资料保留上游原文。
