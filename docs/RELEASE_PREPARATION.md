# 公开源码准备

核查日期：2026-11-01。开发预览版源码采用 MIT、署名 OpenCode Workbench contributors，公开目标为 [materialofair/opencode-workbench](https://github.com/materialofair/opencode-workbench)。package.json 保持 `private: true`，防止误发 npm。本说明记录公开范围和预检，不以计划代替远端发布或 CI 成功证据。

## 公开范围

公开任务管理器 TypeScript、React 页面、OpenCode Skill、可选飞书包装器与来源补丁、测试、构建/安装/扫描脚本、锁文件、文字形式的 JS/CSS/HTML 构建产物、许可证、人工脱敏的验证文档和证据。

不公开 node_modules、任何平台二进制、用户配置、安装包装器、认证信息、模型凭据、聊天/会话、SQLite/WAL、日志、原始截图、私有配置指纹、机器人/用户/会话标识以及本机运行资料。它们不属于 Git tree；不要以整个工作文件夹打包，使用审核后的 Git tree 或 `git archive`。配置样例只引用环境变量及通用路径。

## 来源、版权和许可

- 原创部分根目录附 MIT，署名为 OpenCode Workbench contributors；不是将所有第三方依赖改成同一原创版权。
- 飞书对话核心来自 [NeverMore93/opencode-feishu](https://github.com/NeverMore93/opencode-feishu)，固定 npm 1.10.10。已安装的该精确版本 LICENSE 与仓库保留副本在去除首尾空白后完全一致；再次核对[上游 LICENSE](https://raw.githubusercontent.com/NeverMore93/opencode-feishu/main/LICENSE)，为 MIT、Copyright 2025 NeverMore93。补丁与先前本地 helper 的来源和哈希保留；未冒称此次原创。公开的是适配补丁，不是改名后的完整上游 bundle。
- React/React DOM 19.2.0 与 scheduler 0.27.0 的 MIT 文件字节相同，均为相同的 Meta 版权和许可；全文保存在 third-party，并写入浏览器 bundle 顶部。构建入口保持外部 Node 依赖，不打包本机依赖二进制。
- 锁文件依赖清单共 114 项：MIT 77、Apache-2.0 9、BSD-3-Clause 11、ISC 4、`AFL-2.1 OR BSD-3-Clause` 1、`see package LICENSE` 12。最后 12 项全部是开发用可选 OpenCode 平台二进制；不随源码分发。已安装的 OpenCode CLI 1.19.5 原始许可证为 MIT。尚未逐一下载其他平台的二进制许可证，不能据元数据把它们都宣称为 MIT。若未来分发这些二进制，须另核各包许可证/NOTICE。
- Tencent BrowserSkill 固定 0.4.0 源码已核实 MIT / Copyright (c) 2026 Tencent，保留其 LICENSE/provenance。此次只公开原创互操作工具与流程 Skill，不捆绑 CLI、扩展、图标、第三方依赖或私人适配；完整接入边界见 BROWSER_FEISHU.md。

完整依赖版本/许可元数据见 [DEPENDENCIES.json](DEPENDENCIES.json)，来源说明见 [THIRD_PARTY.md](THIRD_PARTY.md)。这些是来源核对结果，不构成完整法律意见或依赖漏洞审计。

## 可复跑的发布检查

```sh
bun run typecheck
bun run scan
bun run scan:release
git diff --check
git status --short
```

`scan:release` 使用 Git 自身枚举对象库的全部对象，不只检查当前分支，因此包含旧提交、reflog-only 以及不可达对象。扫描文件内容、提交/标签元数据和每个历史文件名，禁止运行/配置路径、二进制内容，检查常见凭据、私人 home 路径、飞书身份、真实会话身份及内网地址。没有按文件大小静默跳过；匹配值不打印。

首次基线（提交 `50ac939`）检查了 106 个对象、3 个提交、74 个不同 blob；当前源码与文档的扫描均无命中。另人工检查了全历史的邮箱、电话号码和本机姓名：仅发现通用的 `contributors@example.invalid` 提交署名，没有个人联系方式。最终计数和每个公开文件的 SHA-256 应以发布时重新生成的私有 `artifacts/release-audit.json` 为准。

扫描器已在独立临时 Git 仓库验证：当前 tree 干净、旧提交已 reset 成不可达时，仍发现其中的合成 token、私人路径、配置路径和二进制；返回失败状态，不打印匹配值。该样例不是实际凭据，临时仓库已删除。

这些规则不能识别任意自定义密钥或全部私人自然语言。人工审阅最终 tree、历史 diff、版权声明和目标仓库仍有必要。没有安装额外扫描服务或上传私有文件；未做外部渗透测试或完整依赖漏洞审计。

## 兼容范围和仍未验收事项

README 的安装命令使用锁文件与 `npm ci --ignore-scripts`，构建依赖 Bun，插件实际运行兼容 Desktop Node sidecar 和 Bun CLI。安装器先 dry-run、再显式 `--apply`，只写自身两个文件；升级须在改动旧构建前用旧安装器卸载，保留旧源码用于回滚。

已验证 OpenCode 1.19.5、macOS arm64、真实 Desktop Skill → 工具 → 页面 → 单次调度完成、按目录实例重建去重。新增 Windows 路径、浏览器、ACL、安装边界与动态加载验证；实际测试层级见 [Windows 说明](WINDOWS.md) 和 [验证记录](VERIFICATION.md)。CI 的实际运行结果不能推断为 Windows Desktop 真实界面、任意 OpenCode 新版本或长期生产稳定性保证。

整个正在使用的 Desktop 进程退出重启、真实睡眠/关机、现用逐项审批按钮、真实飞书收发/附件/卡片回调仍未完成此次端到端验收。飞书只确认既有认证读取、初始化及工具注册，没有发送真实消息。公开描述须保留这些边界，详见 [验证记录](VERIFICATION.md) 和 [飞书说明](FEISHU.md)。

每次发布前重新核对目标仓库、可见性、最终 tree 与全历史扫描结果；不上传忽略文件或个人配置，不执行 npm 发布。创建/推送操作的实际结果应通过远端 default branch、提交 SHA、文件清单及 MIT 检测复核。
