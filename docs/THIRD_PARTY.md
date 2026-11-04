# 第三方声明

原创任务管理器、React 页面、原有 Skill、测试、文档与新适配包装器采用根目录 MIT。第三方版权和许可独立保留。

| 组件 | 固定版本 | 许可 | 处理 |
| --- | --- | --- | --- |
| NeverMore93/opencode-feishu | 1.10.10 | MIT，Copyright 2025 NeverMore93 | 可选依赖；保留原始 LICENSE、来源哈希及独立适配补丁 |
| @opencode-ai/plugin / sdk | 1.19.5 | MIT | 依赖注入与类型，使用原始 npm 包 |
| OpenCode CLI（测试） | 1.19.5 | MIT | 开发依赖，隔离后端测试；不分发本机二进制 |
| React / react-dom | 19.2.0 | MIT | 构建页面；许可证保留于 third-party 及构建 bundle 的 legal comments |
| Bun（运行时） | 本机 1.2.18 | MIT 为主，含所带第三方声明 | 外部运行时，不捆绑其二进制 |
| Playwright / TypeScript（开发） | lockfile | Apache-2.0 | 开发依赖，不作为本机常驻组件 |
| Tencent BrowserSkill | 0.4.0 / 7e300ff6 | MIT, Copyright (c) 2026 Tencent | 保留固定版本许可证；原创互操作适配，不捆绑二进制/扩展/第三方资产 |

实际直接/间接 npm 依赖版本与许可元数据见 `DEPENDENCIES.json`，由已锁定的 package-lock.json 生成。最终分发依赖时仍须附带各包自己的许可证和必要 NOTICE。可选飞书包含 Lark SDK、OpenTelemetry、zod、代理等上游依赖，不能把整个依赖树统称为本项目 MIT 原创。

本机既有 Desktop loader 和 compact Markdown helper 按用户授权的旧适配整理，不包含真实配置、模型定义、用户会话、日志、机器人标识或凭据。上游链接和许可证必须随补丁保留。不得把上游主要功能改名后冒称原创。

## 运维 Skills

`devops-engineer`、`sre-engineer`、`monitoring-expert` 改编自 [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills)，MIT。固定上游提交和逐文件 SHA-256 见 [provenance.json](../third-party/claude-skills/provenance.json)。三个 SKILL.md 已针对内部 Linux/SSH 运维重写；references 保留原文，不宣称原创。原始许可证同时保存在 third-party/claude-skills/LICENSE 和各 Skill 中，安装时一起复制。
