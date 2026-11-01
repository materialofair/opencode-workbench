# 锁定上游依赖的安全告警

日期：2026-11-01。公开 CI 安装的 npm audit 提示触发了进一步核查。对当前 package-lock.json 执行 `npm audit --json --ignore-scripts`，结果为 5 项 high、0 critical；它们是依赖节点计数，不能等同于 5 个本插件可直接利用的独立漏洞。

| 节点 | 原因 |
| --- | --- |
| toml | 多种超长整数、dotted key 或 array-of-tables 输入可导致 CPU 资源消耗 |
| zod | 超大受约束集合验证可能耗尽内存 |
| effect | 继承 toml 的告警 |
| @opencode-ai/plugin | 继承 effect/zod 的告警 |
| opencode-feishu | 继承 @opencode-ai/plugin 的告警 |

公告：[toml 表头](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p)、[toml 路径](https://github.com/advisories/GHSA-9j65-hcg3-gc64)、[toml 整数](https://github.com/advisories/GHSA-9qmh-m7c6-f92p)、[zod 集合](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。具体受影响版本以公告与重新运行的 npm audit 为准。

当前 npm 报告对这些锁定节点的 fixAvailable 均为 false。本项目为保持 OpenCode 1.19.5 与飞书 1.10.10 的可复现兼容，尚未强行覆盖 effect beta、zod 或宿主插件版本，也没有修改现用 Desktop/飞书依赖。因此不能宣称依赖安全审计通过或生产环境已消除这些风险。

本插件的管理 API 仅 loopback，要求鉴权，输入最多 64 KiB；任务结构用自身有限字段校验，不提供 TOML 上传/解析 API，工具参数为空对象。这些边界减少直接暴露，但不构成对上游宿主、其他插件或飞书内容处理路径的完整可利用性证明。不要把它部署成对外服务，也不要向不受信任的群或用户开放飞书入口。

后续需要在兼容测试中采用上游修复版本，再更新锁文件、许可清单和回归证据。没有运行 `npm audit fix --force`，没有升级或覆盖用户现有模型/飞书配置。扫描源码中没有密钥，与依赖告警是两个不同结论。
