# Windows 原生使用与验证

代码适配目标为 Windows 10/11 x64、OpenCode 1.19.5、本地 NTFS 与本机默认浏览器。当前为适配预览，**未完成 Windows 实机/Desktop 端到端验收**，不能当作已验证的 Windows 发行版。WSL 属于 Linux 环境，不能代替原生 Windows 验证。ARM64、网络共享状态目录、开启区分大小写的 NTFS 项目目录和便携式非 NTFS 状态盘目前不在支持范围。

## 安装、升级与卸载

开发机需要 Git、Node 22.22.2+ 的受支持 LTS 分支（CI 固定 22.22.2）和 Bun（CI 固定 1.2.18）。Node 内置 SQLite 自身的下限是 22.13，但锁定的开发依赖 ini 7 要求更高的受支持 Node 版本，因此开发安装使用 22.22.2。使用各自官方安装来源；不需要更改 PowerShell execution policy、防火墙、全局 OpenCode 安全权限，也不创建开机服务。Desktop 使用其自身带有 node:sqlite 的 Node sidecar，构建工具不会替换 Desktop 的运行时。

PowerShell 示例；`npm.cmd` 可避免 PowerShell 将命令解析到 npm.ps1：

```powershell
git clone https://github.com/materialofair/opencode-workbench.git
Set-Location opencode-workbench
npm.cmd ci --ignore-scripts
bun run build
bun run typecheck
bun scripts/install.ts --project "C:\Code\项目 A"
bun scripts/install.ts --project "C:\Code\项目 A" --apply
```

项目目录须已经存在。先检查 dry-run；安装器仅新增两个自身文件，不修改模型、飞书配置或权限。包装器使用 `pathToFileURL` 生成带构建哈希的绝对文件 URL，正确编码盘符、中文、空格、`#`；不要移动源码目录。在 OpenCode 加载该项目的新实例，再说「打开定时任务管理」。如果原实例仍缓存旧插件，等其他工作结束后重开 Desktop；不要在飞书会话或其他任务进行中重启后端。

升级仍须先使用旧源码/旧构建卸载，然后停止宿主并备份整个状态目录，再更新、构建和安装。原地更新也不能省略这个顺序；安装器拒绝覆盖内容不匹配的文件。

```powershell
bun scripts/install.ts --project "C:\Code\项目 A" --remove
bun scripts/install.ts --project "C:\Code\项目 A" --remove --apply
```

卸载不删除数据库或飞书配置，也不能撤回已提交给 OpenCode 的外部操作。Windows 文件仍被 SQLite/宿主打开时不要强删；等宿主完全释放后再备份或移动。

## 路径、浏览器与权限

状态默认位于 `$env:LOCALAPPDATA\opencode-workbench\<项目路径哈希>\tasks.sqlite`；缺失 LOCALAPPDATA 时采用用户 home 的 AppData/Local。显式 XDG_STATE_HOME 可覆盖默认值，需是私人、本地 NTFS 目录。Windows 常规不区分大小写路径会统一盘符、分隔符、大小写与长路径前缀以避免同一项目产生多个任务库；发送给宿主的目录仍保留真实路径。

插件仅对自己创建/使用的这个项目状态目录调用 Windows 自带 whoami/icacls：以数字 SID 限定当前用户和 SYSTEM、关闭继承，再由 SQLite 文件继承该目录访问控制。它不会修改项目目录、用户 profile、其他应用目录或系统策略。ACL 设置失败时不会启动页面或调度器，不尝试提权。不要用管理员模式解决策略拒绝；先选择允许私人 ACL 的本地状态目录。POSIX 模式位 0600/0700 不等于 Windows ACL。

浏览器通过 SystemRoot/System32/rundll32.exe 的 URL handler 启动，以参数数组传入内部生成的 loopback URL，`shell: false`、隐藏控制台、10 秒超时，不使用 `cmd /c start`。启动失败不会把含页面鉴权的 URL返回模型；修复默认浏览器关联后重新调用工具。浏览器和 OpenCode 必须在同一台机器，端口不会对局域网开放。

## SQLite、关闭与时区

Node 使用内置 node:sqlite，Bun 使用 bun:sqlite，不安装另一个 SQLite 服务。WAL、数据库 lease、触发 slot 唯一约束、任务并发和恢复策略与 macOS 相同。数据库位于本地卷；SQLite WAL 不用于 SMB/NFS/同步盘多机共享。

插件依靠宿主 dispose 停止，不给整个 Desktop 注入信号处理器。演示进程处理 Ctrl+C/SIGINT；Windows 任务管理器强制结束不会保证清理 hook 执行，重启后按持久化会话状态核对、不盲目重发，旧 lease 最长等待约 30 秒到期。没有开机启动、睡眠唤醒或关机期间准点执行承诺。

所有每天/每周计划仍填写 IANA 标识（例如 Asia/Shanghai、America/New_York），不使用 Windows 显示的 “China Standard Time” 等系统时区名称。夏令时缺失时刻跳过、重复日只执行一次；单次时间须带 ISO 偏移，间隔为绝对分钟，与 Windows 系统时区选择无关。

## 飞书兼容范围

只安装任务管理器不会启用第二个机器人。可选入口使用 file URL 动态导入、Windows owner 路径归一比较；准备脚本在保留旧补丁哈希验证后额外施加 Windows owner guard。JSON 路径推荐 `C:/Code/项目 A`，反斜杠写成 `C:\\Code\\项目 A`；环境变量占位仍是 `${NAME}`，不在 JSON 中使用 `%NAME%`。

可选配置可以经 OPENCODE_WORKBENCH_FEISHU_CONFIG 指定；Desktop 必须从拥有该环境的进程启动，已经运行的 Desktop 不会自动继承新 PowerShell 变量。真实凭据只在私人配置/宿主环境，不提交源码。Windows 的真实机器人长连接、消息收发、CardKit、附件和审批回调仍需独立测试机器人验收，不能由模拟测试推断为通过。

## 测试层级与证据

本轮开发机器为 macOS；未发现可用的本地 Windows 虚拟机，因此本地仅验证 Windows 纯函数分支与跨平台实现，未声称真实 Windows Desktop 已通过。

本机已通过带中文/空格路径的安装卸载、Windows drive/slash/case/长路径身份、浏览器启动参数与错误、ACL fail-closed 模拟、Windows 目录的宿主 SDK 编码、编译 Node 插件 SQLite/HTTP、编译飞书入口对本地 stub 的真实动态导入，以及既有 UI/时区/审批/去重测试。

脱敏的本机验证汇总见 [cross-platform-local.json](evidence/cross-platform-local.json)，明确标记本机没有 Windows 环境，不包含真实路径或会话标识。

`.github/workflows/ci.yml` 为 windows-latest、macos-latest、ubuntu-24.04 提供相同构建和测试；Linux 固定 24.04，因为 Playwright 1.56.1 不支持当前 ubuntu-latest 所指的 26.04。原生 Windows 额外读取实际 DACL，验证目录及 SQLite/WAL 文件仅含当前用户/SYSTEM。CI 也运行真实 OpenCode 1.19.5 隔离后端和固定 loopback 模型，覆盖审批等待、中止、强制结束后恢复及请求去重。首次初始化会从公开 npm registry 安装宿主插件依赖；总测试超时 180 秒，阶段与失败写入私有 artifacts。没有使用真实凭据或外部消息。

```powershell
bunx playwright install chromium
bun test tests
bun run test:integration
bun run scan
bun run scan:release
```

添加 workflow 不是 CI 已通过的证据；实际 runner 结果以 [GitHub Actions](https://github.com/materialofair/opencode-workbench/actions) 的具体运行链接为准。CI 的无头页面和后端测试也不能代替 Windows Desktop UI、默认浏览器实际启动、真实飞书收发或睡眠/关机验收。

首轮原生 Windows runner 已发现实际差异：Bun 的默认延迟关闭仍占用 SQLite 文件，改为显式 finalize 和严格关闭，并新增关闭后立即重命名/重开的回归；浏览器行为验收改为 Node Playwright，以匹配 Desktop 并避免旧 Bun Windows 子进程管道的启动停滞。测试清理对 Windows 短时文件占用做有限重试，不跳过功能断言。最终是否通过仍以修复后的具体 CI 结果为准。

历史上 [f12ecb0 的 CI](https://github.com/materialofair/opencode-workbench/actions/runs/41303067963)，macOS 与 Ubuntu 24.04 整套通过；云端原生 Windows 核心 31 项全部通过，包括实际 DACL 和 SQLite 重命名回归。Windows 隔离后端已确认完成、等待审批和中止，重启恢复观测仍停留 submitted，UI 后续步骤因此未运行，所以整个 Windows job 失败。随后将恢复 fixture 改为读取宿主实际创建的唯一任务库，避免跨运行时 Windows 临时目录别名导致预测哈希定位到另一库；该调整尚未确认 Windows 重验通过。当前交付按 Mac 本机验证和 Windows 代码适配范围收尾，不以等待更多 Windows runner 作为使用或发布前提，也不隐去失败记录。

参考：[Node Windows 权限限制](https://nodejs.org/api/fs.html#fschmodpath-mode-callback)、[文件 URL](https://nodejs.org/api/url.html#urlpathtofileurlpath-options)、[Microsoft icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)、[Bun 安装平台](https://bun.sh/docs/installation)。

最新已核实的基线 [c1f7480 / run 41303526732](https://github.com/materialofair/opencode-workbench/actions/runs/41303526732/job/124839178304) 在 windows-latest（Windows Server 2025 Datacenter x64，镜像 windows-2025-vs2026）最终全部通过：31 项核心、真实 OpenCode 1.19.5 CLI fixture 的完成/审批/中止/重启恢复（模型请求 2 次），以及 Node 无头 Chromium UI。它没有启动 OpenCode Desktop GUI，不覆盖 Windows 10/11 实机、默认浏览器实际唤起、真实飞书或真实云模型。后续依赖修复的 CI 另以其具体提交结果为准，不能用旧 run 代替新版本验证。
