# 离线审美技能组合

本项目使用一个统一的 `office-visual-composition` skill，而不是同时激活互相冲突的上游指令。它与数据处理的 `office-artifacts` 配合，安装器会复制技能、最小参考与许可证；实际检索由 `office_design_reference` 执行。

## 已接入的三层依据

1. [Anthropic frontend-design](https://github.com/anthropics/skills/tree/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/frontend-design)，Apache-2.0：明确主题、视觉方向、排版与非模板化构图。
2. [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/6ae86f61f520d6ca229d2f40e070410638c908c5/src/ui-ux-pro-max)，MIT：纯本地CSV/BM25查配色角色、字体层级、图表选择和可用性。仅保留8允许域的闭包；不运行上游CLI、安装器、持久化或联网功能。
3. [Vercel web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines/tree/434b7f91364665f2f733b310ec54809bf8f37937)，MIT：语义、焦点、键盘、可读性和工程检查。固定command.md作为离线参考，不采用每次联网的wrapper。

原文许可证、固定提交和逐文件SHA256见 `third-party/design-skills/manifest.json`。未发行的上游文件单独记录，不把未使用的框架参考误称支持能力。外部字体导入/资产链接不进入检索结果，提供系统CJK字体栈；字体在目标机器是否存在仍需验证。没有引入Impeccable联网引擎、遥测或权限绕过。

## 组合执行方式

业务问题与主结论 → 有界本地参考检索 → 两种内容构图草案及取舍 → 字体/颜色/留白/密度tokens → 图表论点与数据来源 → 可执行HTML → 结构/交互QA与截图视觉批评分开 → 修复与复验。

检索例：`office_design_reference({"query":"comparison categories bar chart","domain":"chart","limit":3})`。每个结果都有来源与hash，但没有虚构美学分数。查不到就返回no-match，不随机挑配色。没有实际看截图时，视觉状态必须是pending-human-review。

## 当前构图改版计划

对比过两个方向：A继续共用等权卡片网格，改动小但同质化严重；B按读者任务建立不同阅读路径，共享基础tokens。选择B：

- 经营分析：结论横带、主趋势证据、异常侧栏，再看明细。
- 研究阅读：目录侧轨、窄正文、来源注释，图表作为论证插页。
- 项目推进：阶段/里程碑主线、当前行动和风险分区。
- 决策比较：候选概要、权重证据矩阵、结论与限制；不得凭样式捏造赢家。
- 运营工作台：紧凑状态、筛选反馈、全宽数据区与执行分组。

以上是明确的实施方案，不冒称已经完成所有成品视觉验收。结构差异应通过语义role而非“第几张卡”硬排表达；保留原数据含义和线性阅读次序，窄屏与打印需独立复验。
