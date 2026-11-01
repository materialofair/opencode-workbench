# 可复用飞书 Desktop 适配

## 来源与边界

- 原始对话、CardKit、消息队列、资源处理、会话路由、权限/问答卡片功能：NeverMore93 的 `opencode-feishu@1.10.10`，MIT。
- 本机既有适配：选定 Desktop 项目拥有单一连接；使用宿主动态后端地址/认证；销毁时停止 gateway；删除上游针对 read 的自动批准；可选模型参数；收敛 SDK 日志；精简卡片、Markdown 清理与 UTF-8/JSON 字节预算分页。
- 上述适配已保存为 `adapters/feishu/desktop.patch` 与 `compact-markdown.mjs`，保留来源。它们来自本机先前工作，不将上游整体或这些旧适配冒称此次原创。
- 此次新增：可复现构建/哈希校验、可选入口、显式 owner directory、测试配置路径、遥测默认关闭、安装迁移说明与隔离测试。

原始许可证见 `third-party/opencode-feishu/LICENSE`。来源元数据包含公开 npm 包 bundle 和本地适配 bundle 的 SHA-256。构建先检查上游哈希，按上下文应用补丁，再检查旧适配哈希，最后施加本项目两个明确变更：配置路径 override 与遥测 opt-in。生成文件进入忽略提交的 `.data/feishu`，不修改 node_modules 或当前已安装适配。

## 准备及单独启用

```sh
npm ci --ignore-scripts
bun scripts/prepare-feishu.ts
```

只构建，不读取飞书配置，不连接机器人。可选入口为 `adapters/feishu/plugin.ts`，安装时将其文件 URL 添加到**你选定的隔离项目配置**；不要同时加载原有 `opencode-feishu`、旧 Desktop loader 和本入口。

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

没有发送任何真实飞书消息，也未完成真实机器人长连接重连、CardKit 在线更新、附件下载、交互审批按钮或外部用户身份授权的此次验收；这些需要在明确授权的独立测试机器人里验证。当前飞书接入沿用上游群聊/单聊行为和权限模型，不宣称额外实现了发送者 allowlist 或企业访问控制；不要把机器人对话入口暴露给不受信任的群或用户。

任务管理的会话独立于飞书映射：不会自动把任务结果推送到飞书，也不会复用私聊/群聊 session。通过飞书说「打开定时任务管理」也只打开运行 OpenCode 那台机器的默认浏览器；它不会发出可远程访问的管理链接。

BrowserSkill 只读核查到本机独立 Skill/CLI 与 OpenCode 兼容说明，没有发现可据以完整再分发的许可证声明。本仓库**不打包其文本、CLI、扩展或私有适配**，仅保持与现有工具共存；若未来需要集成再单独核实来源和许可。
