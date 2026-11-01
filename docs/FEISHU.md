# 可复用飞书 Desktop 适配

## 来源与边界

- 原始对话、CardKit、消息队列、资源处理、会话路由、权限/问答卡片功能：NeverMore93 的 `opencode-feishu@1.10.10`，MIT。
- 本机既有适配：选定 Desktop 项目拥有单一连接；使用宿主动态后端地址/认证；销毁时停止 gateway；删除上游针对 read 的自动批准；可选模型参数；收敛 SDK 日志；精简卡片、Markdown 清理与 UTF-8/JSON 字节预算分页。
- 上述适配已保存为 `adapters/feishu/desktop.patch` 与 `compact-markdown.mjs`，保留来源。它们来自本机先前工作，不将上游整体或这些旧适配冒称此次原创。
- 此次新增：可复现构建/哈希校验、可选入口、显式 owner directory、测试配置路径、遥测默认关闭、Windows 文件 URL/owner guard、安装迁移说明与隔离测试。

原始许可证见 `third-party/opencode-feishu/LICENSE`。来源元数据包含公开 npm 包 bundle 和本地适配 bundle 的 SHA-256。构建先检查上游哈希，按上下文应用补丁，再检查旧适配哈希，最后施加本项目的新保护：配置路径 override、遥测 opt-in、Windows owner 路径及有效物理目录标识比较、可选发送者/会话限制和引用正文处理。生成文件进入忽略提交的 `.data/feishu`，不修改 node_modules 或当前已安装适配。Windows 完整范围见 [平台说明](WINDOWS.md)。

## 准备及单独启用

```sh
npm ci --ignore-scripts
bun run build
bun scripts/prepare-feishu.ts
```

只构建，不读取飞书配置，不连接机器人。可选入口为构建后的 `adapters/feishu/plugin.js`，安装时将其文件 URL 添加到**你选定的隔离项目配置**；不要同时加载原有 `opencode-feishu`、旧 Desktop loader 和本入口。

配置使用上游结构，必须在私有目录设置显式 `directory`：

```json
{
  "appId": "${FEISHU_APP_ID}",
  "appSecret": "${FEISHU_APP_SECRET}",
  "directory": "/absolute/path/to/owner-project"
}
```

这只是示例，不能填真实凭据后提交。凭据通过宿主进程的环境提供，插件不会为你创建持续凭据。默认配置仍是 `~/.config/opencode/plugins/feishu.json`；新副本支持环境变量 `OPENCODE_WORKBENCH_FEISHU_CONFIG` 指向测试配置。owner 与当前 ctx.directory 的真实路径不同时返回空 hooks，避免多项目建立重复连接。

后台 SDK 使用 ctx.serverUrl、进程内 `OPENCODE_SERVER_PASSWORD` 与 username 适配上游 v2 回调，仅支持 loopback；任务管理器本身完全使用宿主注入 client。所有凭据留在后端进程，不暴露给管理页面。新入口默认关闭 Langfuse 用户追踪，即使进程有其凭据；如维护者确需发送该追踪，需明确设置 `OPENCODE_WORKBENCH_FEISHU_TELEMETRY=1` 并自行告知用户/取得适用授权。

迁移现有连接应先结束旧 OpenCode 后端，备份私有配置与旧入口，再切换加载路径；只启一个 bot owner。验证后保留旧版以便恢复。**本轮未对现有配置或入口执行迁移**。卸载新副本只移除它的插件引用并退出其宿主；恢复旧引用即可回滚，不必重建机器人。

## 验证与限制

自动化使用公开上游代码及模拟 client 测试：哈希构建、动态 loopback 地址、模拟认证、无配置不连接、同聊天会话复用、重启查找、/new 轮换、长 Unicode/代码段分页及 payload 预算。不读取真实配置或私有消息。

隔离自动化未发送真实飞书消息。用户后续自行发送了旧卡片引用测试，机器人产生回复，但原文未恢复；新卡片正文复述、完整长连接故障恢复、附件、真实交互审批按钮和外部用户授权仍未完成验收。新入口支持私人配置中的 allowedSenderIDs / allowedChatIDs，接收消息和卡片回调均检查，审批回调另绑定原 request/session/chat 并限制过期/重复；启用本项目浏览器工具时两项必填。它不是企业访问控制，旧独立桥不会自动获得新限制；不要把入口暴露给不受信任用户。

任务管理的会话独立于飞书映射：不会自动把任务结果推送到飞书，也不会复用私聊/群聊 session。通过飞书说「打开定时任务管理」也只打开运行 OpenCode 那台机器的默认浏览器；它不会发出可远程访问的管理链接。

已核实 Tencent BrowserSkill 固定 0.4.0 源码的 MIT / Copyright (c) 2026 Tencent；此前“未发现许可证”的判断已纠正。可移植工具与原创 Skill、独立安装和分发边界见 [浏览器接入](BROWSER_FEISHU.md)。不打包 CLI、扩展、第三方资产或本机私人 Skill。


## 引用消息

仅按事件 `parent_id` 读取直接父消息；`root_id` 不替代直接引用，`upper_message_id` 属于合并转发容器。REST 单消息读取显式传 `card_msg_content_type=user_card_content`，请求 1.0/2.0 卡片原始 JSON，再按 `data.items[].message_id` 精确匹配；正文使用 `msg_type` / `body.content`，校验同一 chat、未删除，并限制长度、层级和节点数。支持 text、post、交互卡片可见文本（包括嵌套行的 tag:text/text）。引用作为不可信 JSON 数据加入 prompt；读取失败、权限不足、不支持或旧卡片占位均明确标记正文不可用，不猜测历史答案。

对于本桥之后成功发送并完成渲染的卡片，保存精确消息/会话对应的最终正文到项目私人状态目录 quotes/receipts.json，最多 200 条、引用读取有效期 24 小时、每条 4000 字符；POSIX 0700/0600、Windows 私人 ACL。过期记录在后续写入时从磁盘轮换移除，停用不会自动擦除文件。重启可恢复有效记录；仅在已有权限成功读取同一未删除消息后，用于补足飞书返回的卡片占位正文。读取失败或消息删除绝不从缓存恢复。历史卡片不会自动补建正文；缓存失败不影响正常发消息。缓存含对话文本，不提交、不共享；停用后可在宿主退出时删除 quotes 目录。

指定真实会话的只读排查确认：现有权限读取直接父消息成功，交互卡片返回嵌套文本行，但内容是平台客户端提示。没有新增权限、重建旧卡片或发送调试消息。原始 WS 事件未被留存；这项结论来自已保存 prompt、实际 REST 响应与实现核查。现用独立机器人已在确认空闲后备份、只施加引用修复并正常重启；身份读取和网关初始化成功，无缓存警告/飞书错误，配置及其他组件未改变。它没有迁移到本项目的新发送者策略或浏览器入口；早期用户旧卡片引用只进入会话一次，助手完成但原文未恢复；默认 API 返回占位，且无旧回执或精确历史映射。随后核实官方 raw-card 查询参数，同一张真实旧卡片在已有权限下返回原始 2.0 JSON，已提取正文，且与本地存储的一条回答完全一致。查询补丁现已在空闲重启后加载，无新增权限/配置变动；仍待用户再次引用原卡片确认端到端复述，不将一次只读 API 成功描述为客户端全链通过。

查询参数由当前锁定 Lark SDK 的 `im.message.get` 类型支持；官方接口入口见 [消息读取 API](https://open.feishu.cn/api-explorer?project=im&resource=message&apiName=get&version=v1)。仅处理受限的可见文本字段，不将按钮 value、原始卡片配置或凭据转给模型。不支持/拒绝读取的卡片仍明确降级；正文回执是补充路径，不应以缺少旧回执判定官方原始内容不可读。
