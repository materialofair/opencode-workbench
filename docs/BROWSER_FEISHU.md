# 飞书 → OpenCode → 浏览器 → 飞书

此可选接入让已有飞书入口调用项目专属 `workbench_browser` 工具，再由原对话的飞书桥发送经过核对的结果。默认不启用，不替换已运行的机器人，不自动安装或启动 BrowserSkill，也不改变浏览器安全设置。

## 依赖与版权

使用 OpenCode 1.19.5、Bun 1.2.18、独立安装的 [Tencent BrowserSkill 固定版本安装说明](https://github.com/Tencent/BrowserSkill/blob/7e300ff6a35b326ac9abd03f315f30769ad01861/README.md#quick-start) 中的 Tencent BrowserSkill CLI/daemon/Chrome 扩展 **0.4.0**。官方三个 v0.4.0 tag 固定到 `7e300ff6a35b326ac9abd03f315f30769ad01861`，其根许可证为 MIT，Copyright (c) 2026 Tencent。见 [固定版本许可证](../third-party/browser-skill/LICENSE) 与 [来源](../third-party/browser-skill/provenance.json)。本仓库提供原创互操作适配和流程 Skill；不分发 CLI、扩展、图标、第三方依赖或本机私人 Skill。BrowserSkill 本身及其浏览器权限按上游说明单独安装、授权和检查，不通过本插件扩大权限。

## 安装与配置

先按 README 获取源码，执行 `npm ci --ignore-scripts`、`bun run build`。在一个明确的项目目录安装工具和原创流程 Skill：

```sh
bun scripts/install-browser.ts --project /absolute/project
bun scripts/install-browser.ts --project /absolute/project --apply
```

Windows PowerShell 同样调用该脚本，项目参数可为 `C:/Code/My Project`。先运行 dry-run；安装器遇到不同内容、符号链接或 junction 会停止。它只创建 `workbench-browser.js` 和 `feishu-browser/SKILL.md`，不修改其他插件、模型或全局 Skill。

复制 [配置样例](../examples/browser.config.example.json) 到项目私人 `.opencode/workbench-browser.json`，填入项目真实目录、独立 bsk 可执行文件的绝对路径、`bsk status --json` 中明确的浏览器 instance_id 或唯一 label。Windows bskPath 指向 `bsk.exe`。`allowedOrigins` 是精确 http(s) origin 白名单，不能使用路径、通配符或带账号的 URL；`actions` 显式启用所需操作。默认样例只允许 navigate。目录和路径可使用 `${ENV_NAME}`，Desktop 需从继承相应环境的进程启动。可用 `OPENCODE_WORKBENCH_BROWSER_CONFIG` 指向其他私人配置；不配置则不注册工具。

确认已有 BrowserSkill 0.4.0 daemon 与扩展正常连接后，安全重载该项目宿主。插件禁用 CLI 自动启动/更新；不替代上游安装、配对或人工授权。不要在已有任务运行时重建宿主或共享 daemon。

飞书按 [飞书适配说明](FEISHU.md) 单独安装。本项目新飞书入口在浏览器启用时要求私人飞书配置同时包含 `allowedSenderIDs` 和 `allowedChatIDs`，值来自自己已核实的飞书用户与会话；不要猜测或将真实值提交仓库。只允许明确可信的单聊/群聊。先前安装的独立飞书桥不会因安装浏览器工具而自动获得该限制，使用前应迁移或自行核实访问边界。不要同时加载两个拥有同一机器人的桥。

## 操作和权限

在飞书明确提出浏览器任务，OpenCode 加载 `feishu-browser` Skill。每个源使用独立 owned session，start 和每个有副作用的操作都调用宿主权限审核；拒绝时不派发操作。上游桥将宿主审批转成原会话卡片，收到明确批准再继续。回调绑定发送时的 request/session/chat，10 分钟过期，拒绝未知、伪造和重复请求；过期后应在宿主界面核对/结束旧请求，再发起新任务。不要配置全部工具自动允许。工具未暴露发送飞书任意目标消息的入口，结果沿原桥的会话映射返回。

初始导航后必须 cooperate sync/read：每个确切 context_id 仅供一个动作，报错或拒绝后也不能重放旧 context。工具绑定 OpenCode session、浏览器和任务 tab，验证精确来源、观察中的 ref 与就绪状态。人工编辑/hold、控制拒绝、用户停止和真实安全限制均保留。不存在换浏览器绕过拒绝、借用用户 tab、执行任意页面脚本、读取 cookie 或重启共享 daemon 的工具。

导航或页面卡死时停止本任务的 handle，再按用户授权处理其他来源；不得把搜索摘要当作已读文章。未知派发结果不能自动重放。CLI start 超时会阻止同一 OpenCode 会话再次 start，需先在上游任务历史人工核对遗留任务。服务退出只能尽力清理自身任务；强制退出后应在 BrowserSkill 自己的任务界面核查遗留 Agent Window。

本地页面内容、模型收到的 DOM 和填写值可能包含个人信息；按宿主会话数据保护，不提交日志。来源白名单约束工具请求/观察，不构成浏览器网络防火墙，页面的子资源请求仍由浏览器处理。

## 验证边界

Mac 上已用真实 BrowserSkill 0.4.0 与真实 Chrome 在受控本地页面完成导航、sync、填入合成值、以新 context 点击、读取结果和清理，结束后 owned session 数为零。

隔离整链测试使用真实 OpenCode 1.19.5 和真实无头 Chromium，但飞书 SDK 与 BrowserSkill CLI 为测试协议替身；没有连接真实飞书、发送真实消息或使用云模型。该测试及当前 CI 的确切结果见验证记录，不能替代真实飞书交互卡片验收。Windows 提供代码适配和 CI；本轮已发现并修复短路径/长路径 owner 别名问题，只有有效且相等的设备/文件标识才允许该 Windows 目录匹配。尚无 Windows 10/11 Desktop、扩展、真实飞书整链验收；完整 CI 以具体提交为准。

## 升级和卸载

升级前结束本项目任务，用旧版本安装器 `--remove --apply` 删除其拥有的文件，更新构建后重新安装；文件内容改变时先备份，不强行覆盖。卸载使用：

```sh
bun scripts/install-browser.ts --project /absolute/project --remove --apply
```

安全重载该项目宿主后生效。私人配置、现有飞书机器人、BrowserSkill 安装及其数据都保留。该卸载不会撤销已发生的外部操作。

首次部署必须由本人先完成上游 CLI、daemon 和 Chrome/Edge 扩展安装及连接授权，核对 CLI/daemon/扩展均为 0.4.0，再用 `bsk status --json` 核查明确实例。商店或 latest 安装可能已经是其他版本；本适配严格拒绝版本不匹配，应使用固定版本或另行做兼容验证，不通过禁用版本/安全检查解决。没有 bsk 或扩展仅能运行替身测试，不能执行真实浏览器任务。样例 actions 只含 navigate；若本人需要填表/点击，应逐项加入 fill/click/press 并保留每次宿主审批。
