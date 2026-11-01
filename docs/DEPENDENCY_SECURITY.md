# 上游依赖安全核查与修复

核查日期：2026-11-01。原锁文件 npm audit 为 5 个 high 节点，涉及 4 个公告；没有发现被利用的证据，也不是 5 个独立可利用入口。新锁文件在隔离干净安装后为 **0 已知告警**，这不等于整个 OpenCode 客户端或所有未知漏洞都安全。

## 逐节点路径与可达性

| 原告警节点 | 依赖路径与原版本 | 本项目实际范围 | 修复 |
| --- | --- | --- | --- |
| zod | workbench → @opencode-ai/plugin 1.19.5 → zod 4.1.8 | 根 plugin 只导出 tool.js，tool.schema 直接绑定 Zod；任务管理器参数为空对象，但飞书卡片/表单有真实集合 schema。潜在验证 DoS，不能宣称已被利用 | 限定该 plugin 的 Zod 为 4.6.7 |
| toml | workbench → @opencode-ai/plugin → effect 4.0.0-beta.83 → toml 4.3.0 | 唯一静态消费者是 effect/unstable/cli/Primitive 的 TOML 文件解析。本项目任务、HTTP、Skill、飞书入口均未导入该消费者，也没有 TOML 输入端点 | 限定该 Effect 的 TOML 为 5.0.1 |
| effect | 同上，版本仍为 4.0.0-beta.83 | 继承 toml 告警，不是此次发现的独立 Effect 漏洞；普通 plugin/tool 导入不加载 Effect CLI | 保留 Effect ABI，仅更新子依赖 |
| @opencode-ai/plugin | 根直接依赖 1.19.5 | 继承 zod/effect 告警；可达 Zod 与未使用的 CLI TOML 需分别判断 | 保留宿主兼容版本，仅覆盖两个叶子依赖 |
| opencode-feishu | 可选 1.10.10 → peer @opencode-ai/plugin；另有 zod ^4.3.6 | 上游包内原已解析到 Zod 4.6.7，但适配 bundle 迁到 .data 后从项目根解析 Zod 4.1.8，卡片/表单 schema 又使用 tool.schema，因此不能只看上游嵌套副本 | 根解析统一到 4.6.7；不更改上游 bundle 或既有桥 |

依据是已安装包的 dist/index.js、dist/tool.js、Effect Primitive.ts/js，以及飞书 bundle 的 FeishuConfigSchema、SelectFieldSchema、FormSectionSchema、createSendCardTool/createRequestFormTool。SDK 类型导入会在构建时擦除。本结论仅覆盖这些仓库入口，不外推为宿主或其他插件的完整调用图。

## 逐公告与官方修复

| 公告 | 公布影响范围 / 修复版 | 对原 toml 4.3.0 / zod 4.1.8 的核对 |
| --- | --- | --- |
| [GHSA-4qx8-w7c3-pj3p](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p) | toml ≤5.0.0；5.0.1 修复 array-of-tables 二次复杂度 | 原 compiler 的 addTableArray 确有对 assignedPaths/valueAssignments 的反复全量扫描；本项目未暴露该解析入口 |
| [GHSA-9j65-hcg3-gc64](https://github.com/advisories/GHSA-9j65-hcg3-gc64) | toml ≤5.0.0；5.0.1 修复超长 dotted key/path 二次复杂度 | 原 assign/deepRef/setNestedKey 确有 keys.slice 前缀反复构建；本项目未暴露该解析入口 |
| [GHSA-9qmh-m7c6-f92p](https://github.com/advisories/GHSA-9qmh-m7c6-f92p) | toml ≤5.0.0；5.0.1 修复巨量数字在边界检查前进入 BigInt | 原 4.3.0 parser 对四种整数均调用 parseInt，没有该公告描述的 BigInt 转换路径；范围命中不能直接证明此特定机制可利用。仍统一升级，避免未来引入该路径 |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod <4.6.6；4.6.6 修复 | 旧版本会先逐元素验证，再报告集合上限。飞书包含 max(20)/max(10) 等 schema，可间接处理模型提供的参数；没有证明匿名网络请求可直接调用或已经造成攻击 |

官方说明：[TOML 5.0.1 changelog](https://github.com/BinaryMuse/toml-node/blob/v5.0.1/CHANGELOG.md)、[Zod 修复提交](https://github.com/colinhacks/zod/commit/a0ebf97)。此前 fixAvailable:false 只表示 npm 沿原约束不能自动修复，不表示上游没有补丁。

## 有限覆盖与兼容性

package.json overrides 精确限定 @opencode-ai/plugin@1.19.5 的 zod=4.6.7，以及 effect@4.0.0-beta.83 的 toml=5.0.1。OpenCode plugin/SDK 1.19.5、Effect beta.83 和飞书 1.10.10 均不升级；没有运行 npm audit fix --force。

TOML 跨主版本不是无条件 drop-in：5.x 对超出 JavaScript 安全整数范围的默认解析改为抛错，替代旧版静默舍入。当前产品不使用 TOML，且已通过实际 Effect CLI 消费者的代表性合法数据测试，因此不影响本项目已有功能；若未来开放 TOML，应明确数值语义。两包仍为 MIT，原版权许可随 npm 包保留，锁文件许可清单已重生。

隔离副本从公开源码和新锁文件 npm ci --ignore-scripts，未复制真实配置。新增子进程测试限制 256 MiB、8 秒：检查 array/set/map 超限时元素验证次数为 0，巨量整数在 BigInt 前拒绝，有限规模 dotted key/table 输入可解析，真实 Effect CLI 消费者与保留飞书 schema 的合法输入兼容。测试不制造大型 OOM、不调用真实模型或机器人。

Mac 完整回归 32 通过、1 项 Windows 专用检查跳过；真实 OpenCode 1.19.5 隔离模型测试确认完成、等待审批、中止、重启恢复，模型请求仍为 2。CI 另执行 npm audit --audit-level=high；实际最终状态以对应 run 为准。

## 修复边界及升级

修复针对此源码项目新安装的依赖。当前用户 Desktop 内置依赖、已加载的模块、原飞书目录和真实配置均未原地替换，不宣称已修补整个客户端。开发工作区原 node_modules 也保留，修复是在独立临时副本验证；旧安装要按 README 的安全卸载/备份顺序，在工作结束后使用新锁文件 npm ci 并重新加载，不能只刷新网页。

原有 loopback 鉴权、64 KiB HTTP 上限、宿主逐项权限与遥测 opt-in 继续保留；它们是边界，不是替代依赖修复。没有绕过审计、屏蔽公告或移除有效检查。未执行真实飞书/云模型验收或外部渗透测试。

脱敏的版本、审计和隔离测试结果见 [dependency-security.json](evidence/dependency-security.json)。依赖许可清单可用 `bun scripts/dependency-report.ts` 从锁文件重新生成。
