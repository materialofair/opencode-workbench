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

隔离自动化未发送真实飞书消息。最初旧卡片引用测试未恢复正文；追加官方原始卡片查询参数后，用户已确认现用机器人能正常识别引用。该用户确认仅覆盖现有 Mac 连接的引用功能，不替代新入口迁移、完整长连接故障恢复、附件、真实交互审批按钮和外部用户授权验收。新入口支持私人配置中的 allowedSenderIDs / allowedChatIDs，接收消息和卡片回调均检查，审批回调另绑定原 request/session/chat 并限制过期/重复；启用本项目浏览器工具时两项必填。它不是企业访问控制，旧独立桥不会自动获得新限制；不要把入口暴露给不受信任用户。

任务管理的会话独立于飞书映射：不会自动把任务结果推送到飞书，也不会复用私聊/群聊 session。通过飞书说「打开定时任务管理」也只打开运行 OpenCode 那台机器的默认浏览器；它不会发出可远程访问的管理链接。

已核实 Tencent BrowserSkill 固定 0.4.0 源码的 MIT / Copyright (c) 2026 Tencent；此前“未发现许可证”的判断已纠正。可移植工具与原创 Skill、独立安装和分发边界见 [浏览器接入](BROWSER_FEISHU.md)。不打包 CLI、扩展、第三方资产或本机私人 Skill。


## 引用消息

仅按事件 `parent_id` 读取直接父消息；`root_id` 不替代直接引用，`upper_message_id` 属于合并转发容器。REST 单消息读取显式传 `card_msg_content_type=user_card_content`，请求 1.0/2.0 卡片原始 JSON，再按 `data.items[].message_id` 精确匹配；正文使用 `msg_type` / `body.content`，校验同一 chat、未删除，并限制长度、层级和节点数。支持 text、post、交互卡片可见文本（包括嵌套行的 tag:text/text）。引用作为不可信 JSON 数据加入 prompt；读取失败、权限不足、不支持或旧卡片占位均明确标记正文不可用，不猜测历史答案。

对于本桥之后成功发送并完成渲染的卡片，保存精确消息/会话对应的最终正文到项目私人状态目录 quotes/receipts.json，最多 200 条、引用读取有效期 24 小时、每条 4000 字符；POSIX 0700/0600、Windows 私人 ACL。过期记录在后续写入时从磁盘轮换移除，停用不会自动擦除文件。重启可恢复有效记录；仅在已有权限成功读取同一未删除消息后，用于补足飞书返回的卡片占位正文。读取失败或消息删除绝不从缓存恢复。历史卡片不会自动补建正文；缓存失败不影响正常发消息。缓存含对话文本，不提交、不共享；停用后可在宿主退出时删除 quotes 目录。

指定真实会话的只读排查确认：现有权限读取直接父消息成功，交互卡片返回嵌套文本行，但内容是平台客户端提示。没有新增权限、重建旧卡片或发送调试消息。原始 WS 事件未被留存；这项结论来自已保存 prompt、实际 REST 响应与实现核查。现用独立机器人已在确认空闲后备份、只施加引用修复并正常重启；身份读取和网关初始化成功，无缓存警告/飞书错误，配置及其他组件未改变。它没有迁移到本项目的新发送者策略或浏览器入口；早期用户旧卡片引用只进入会话一次，助手完成但原文未恢复；默认 API 返回占位，且无旧回执或精确历史映射。随后核实官方 raw-card 查询参数，同一张真实旧卡片在已有权限下返回原始 2.0 JSON，已提取正文，且与本地存储的一条回答完全一致。查询补丁现已在空闲重启后加载，无新增权限/配置变动；用户随后确认现用连接引用识别正常；这是用户实际操作确认，没有在本次新机器审计中读取私人消息或重发测试。它不等于新机器整链已实测。

查询参数由当前锁定 Lark SDK 的 `im.message.get` 类型支持；官方接口入口见 [消息读取 API](https://open.feishu.cn/api-explorer?project=im&resource=message&apiName=get&version=v1)。仅处理受限的可见文本字段，不将按钮 value、原始卡片配置或凭据转给模型。不支持/拒绝读取的卡片仍明确降级；正文回执是补充路径，不应以缺少旧回执判定官方原始内容不可读。

## 新机器配置的必要步骤

先在自己的飞书租户按 [上游 1.10.10 安装说明](https://www.npmjs.com/package/opencode-feishu/v/1.10.10) 创建自建应用、启用机器人能力、选择长连接接收事件/回调，订阅 `im.message.receive_v1` 和 `im.chat.member.bot.added_v1`；需要交互审批时配置 `card.action.trigger` 回调。上游列出的权限是 `im:message`、`im:message:send_as_bot`、`im:chat`、`im:message:readonly`、`contact:user.base:readonly`。实际权限、卡片/附件 API 和应用发布由租户管理员按用途审核；缺少权限时按对应 API 错误处理，勿自动扩大权限。应用需发布并对自己的测试用户可用。这些步骤不会由本仓库自动完成。官方事件说明见 [接收消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)。

在源码根目录生成插件绝对 URL（macOS 和 PowerShell 均可执行）：

```sh
node --input-type=module -e "import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';console.log(pathToFileURL(resolve('adapters/feishu/plugin.js')).href)"
```

将输出加入选定项目已有 `opencode.json` 的 `plugin` 数组，保留其他配置，勿覆盖整个文件：

```json
{"plugin":["file:///ABSOLUTE/SOURCE/adapters/feishu/plugin.js"]}
```

此 URL 是占位，Windows 实际输出为 `file:///C:/...`。源码目录须保留。将上方私人配置存到自己受保护的目录，设置 `OPENCODE_WORKBENCH_FEISHU_CONFIG` 及 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 后，从继承这些环境的终端启动新的 OpenCode；已运行的 Desktop 不会获得后来设置的变量。macOS 示例 `export OPENCODE_WORKBENCH_FEISHU_CONFIG=/private/path/feishu.json`；PowerShell 示例 `$env:OPENCODE_WORKBENCH_FEISHU_CONFIG='C:/Private/feishu.json'`。凭据仅在自己的终端安全设置，不放入命令历史示例或仓库。

浏览器项目的私人配置还必须包括 `allowedSenderIDs` 和 `allowedChatIDs` 两个非空数组，填自己核实的允许用户/会话。启动前确认旧桥已停止、模型已在这个项目配置且能完成普通对话；不要同时运行相同机器人。首次真实收发和审批必须由部署者自行测试，本仓库 CI 不提供真实飞书账号验证。
