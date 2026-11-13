# 内网办公产物引擎（开发预览）

这是现有 Workbench 的**独立可选适配器**，不是替换定时任务插件，不是另一个在线 App。内网 OpenCode 使用其现有模型（例如 GLM5.3）；此模块没有模型供应商、网络客户端、API 密钥或云端文件上传逻辑。现有 HTML 转 PPT skill 完全不变。

## 实现架构

OpenCode tools → 有界 JSON / 无 shell 子进程 → 项目路径校验 → Python 确定性引擎 → 新建 HTML/XLSX → 只读复核及本地浏览器 QA。

- `office_inspect_excel`：文件只读分析；OOXML 结构与图表证据、公式和缓存、工作表/样式/布局等信息。大量数据采用有界抽样，不能声称抽样等于全量分析。
- `office_generate_excel`：XlsxWriter 原生 Excel 数据、格式、公式、原生图表；不修改已有复杂工作簿。
- `office_render_html`：场景布局与原生 SVG 图表，全部样式/资源内联，中文可用系统字体，无 CDN。
- `office/qa-html.mjs`：实际本地浏览器验证；输出检查结果和多视口截图，不能用 DOM 结果冒充审美验收。
- 所有数据处理在当前机器运行，最终授权边界仍由 OpenCode/操作系统和企业网络策略负责。路径限制不是针对恶意同机进程的安全沙箱；同机进程可更换符号链接，部署时应使用独立低权限账号/容器和禁止网络的运行环境。

## 运行与离线准备

Python 3.10+；依赖版本见 `office/requirements.txt`，新建和读取分别使用 XlsxWriter / openpyxl。开发 Python 环境放在 `office/.venv`，不改系统 Python。Node/Bun 版本沿用仓库 README；匹配浏览器和 Playwright 版本须预置。

有网的受控构建机先从官方 PyPI 获取 requirements 中**确切版本**及传递依赖，保留 wheels 和许可证，计算 SHA256 后随内网发行包交付。运行时不执行 pip/npm/bun install 或浏览器下载：

```sh
python3 -m venv office/.venv
# 在受控构建机执行；目标内网机只执行下面 no-index 一行
# python -m pip download -r office/requirements.txt --dest office/wheelhouse
# 按目标操作系统/Python ABI 分别准备 wheelhouse 与 SHA256 清单
 office/.venv/bin/python -m pip install --no-index --find-links office/wheelhouse -r office/requirements.txt
bun scripts/build-office.ts
bun run typecheck
PYTHONPATH=office office/.venv/bin/python -m unittest discover -s office/tests -v
bun test tests/office.test.ts
```

Windows 使用 `office/.venv/Scripts/python.exe`，可通过**运行宿主时由管理员配置的** `OPENCODE_OFFICE_PYTHON` 指向已审批的解释器。工具参数不能改变解释器。本版本 Windows 未实机验收，不宣称生产可用。

仅预览安装：

```sh
bun scripts/install-office.ts --project /absolute/path/to/project
# 检查列表后才应用
bun scripts/install-office.ts --project /absolute/path/to/project --apply
```

只新增项目 `.opencode/plugins/office-artifacts.js` 和 `.opencode/skills/office-artifacts/SKILL.md`。内容冲突拒绝覆盖。不修改 opencode.json、模型、权限、现有技能，不重启宿主。源码路径须保持有效；加载全新宿主项目后工具才会注册。

## JSON CLI 与协议

```sh
printf '%s' '{"operation":"inspect_excel","input":"book.xlsx"}' | 
  PYTHONPATH=office office/.venv/bin/python -m office_engine --root /absolute/project
```

每次请求最多 1 MiB；插件超时 120 秒，输出报告上限 8 MiB。超时后应检查是否已有文件，不能盲目重试覆盖。输入/输出必须为项目相对路径，不允许 `..`、绝对路径或指向项目外的符号链接；输出父目录应已存在。所有生成输出使用新文件名，禁止覆盖。

生成 XLSX：`{"operation":"generate_excel","output":"new.xlsx","spec":{"sheets":[{"name":"Sales","rows":[["Month","Revenue"],["Jan",100],["Feb",120]],"freeze":[1,0],"autofilter":true}]}}`。

Sheet `rows` 可用普通数据或显式公式对象 `{ "formula": "=SUM(B2:B3)", "cached": 220 }`。普通字符串不自动当公式。缓存是调用方给定的结果，**不等于引擎验证或计算正确**；必须基于可审计独立计算。没有结果时明确待重算。图表引用使用 `[sheet, r1, c1, r2, c2]`，行列从 0 起。完整受支持字段及错误情况见 Excel 测试，不支持的字段不能靠提示词变成能力。

HTML 采用 version 1 spec：`scenario/title/sections`，每节含 `type` 与数据；实际例子见 `office/examples/`。共享图表格式是 `type/title/categories/series`，每个 series 包含 `name/values`，用于 HTML 图表和 Excel 原生图表输入。Excel 数值与 HTML 数值必须采用同一源数据。

## 保真、计算与安全边界

- 不执行 VBA、外部链接、Power Query 刷新、DDE、嵌入对象或任意脚本。分析到这些对象不等于支持它们的编辑/运行。
- 不提供 XLS/XLSB/加密工作簿通用解码；不提供复杂已有模板“无损读写”。透视表、切片器、组合图、复杂格式等作为风险/结构证据，未实现部分明确返回。
- openpyxl 不计算公式；缓存可能缺失/过期。XlsxWriter 写公式不能替代 Excel/LibreOffice 计算。禁止将默认 0 或旧缓存解释为已验证计算结果。
- 模型给出的正文、数字、业务结论仍需审阅。文件中的指令不获得执行权。HTML 内容转义且无任意模板代码；Office 文件不上传至外部服务。
- 每次交付报告实际通过/失败/未运行的验证，不称“所有复杂 Excel 均支持”。真实公司文件、GLM5.3 工具调用、内网部署和 Windows 实机未验证时必须保留这些限制。

## GitHub 调研与许可证决策

选型依据（2026-11-13 核查）：

- [XlsxWriter](https://github.com/jmcnamara/XlsxWriter)：BSD-2-Clause，新建 XLSX/图表；不读取现有工作簿。
- [openpyxl](https://openpyxl.readthedocs.io/en/stable/tutorial.html)：MIT，只读解析；官方说明公式不计算且 shapes 可能在保存时丢失，因此本工具不保存原始文件。
- [Playwright](https://github.com/microsoft/playwright)：Apache-2.0，真实 DOM、交互和截图 QA。浏览器和系统字体须在内网预置。
- [ECharts](https://github.com/apache/echarts)：Apache-2.0，调研过但当前不引入；本版 SVG 足够且降低离线依赖。更复杂交互图表可后续审批 vendoring。
- [ExcelJS charts issue](https://github.com/exceljs/exceljs/issues/2607)：不采用它作为复杂图表保真核心。
- [Excelize](https://github.com/qax-os/excelize)：BSD-3-Clause，候选复杂引擎；增加 Go 与计算兼容测试成本，未引入。
- [Anthropic skills](https://github.com/anthropics/skills)：调研参考，当前上游说明文档技能为 Apache-2.0；没有复制其技能或实现，不依赖上游提示词作为执行引擎。

本次 Python/TypeScript 实现为本仓库原创，沿用项目 MIT。第三方不直接复制入源码，发行 wheelhouse 前应从**锁定版本包**收集 LICENSE 和 SHA256，不凭仓库首页推断发行许可。当前开发验证不等于已完成内网供应链发行包。

实际固定依赖许可元数据及发行包内可用的许可证原文已提取到 `third-party/office-engine/`，含 SHA256：openpyxl 3.1.5 MIT、XlsxWriter 3.2.9 BSD-2-Clause、defusedxml 0.7.1 PSFL、et-xmlfile 2.0.0 MIT。四项依赖许可证原文已从固定wheel或源码发行包补齐。这不是 wheelhouse 完整性清单。

## 本地验证记录（2026-11-13）

- Mac：完整仓库 build 与 typecheck 通过；首轮办公 Python 26项通过（Excel15、HTML9、CLI边界2）；OpenCode 适配/安装器4项通过。
- 五个场景各1440/768/390共15视口 Chromium QA通过。已人工目视五个桌面版和dashboard手机版。其他手机视图只完成自动QA，不声称逐张目视。
- 首轮完整 Bun 回归曾发现复用依赖的zod版本错配。现已取消链接，独立npm ci，并使用官方Node22.22.2复验：55通过、1跳过（Windows ACL实机）、0失败。没有改用户原node_modules。
- 合成示例运行：`PYTHONPATH=office office/.venv/bin/python office/demo.py NEW_DIRECTORY`，目录必须尚不存在。示例只证明支持的schema，不证明任意公司模板的保真与业务正确性。
- 未安装到用户现有OpenCode项目，未真实调用内网GLM5.3，未push/发布，未完成Windows或公司内网端到端验收。

五场景样本后续继续迭代独立业务信息架构，不宣称已具备任意行业语义模型。

## 离线交付与安全审计补充

- 已准备4个纯Python通用wheel，清单与SHA256在 `office/wheelhouse-manifest.json`；严格安装使用 `pip install --no-index --find-links office/wheelhouse --require-hashes -r office/requirements-offline.lock`。已在全新虚拟环境仅用本地文件完成安装和26项测试。
- wheels在本地忽略目录，不进入git；发行时需和源码一起打包。Node运行时、npm缓存、匹配Playwright浏览器和目标系统字体仍须按目标平台准备。不要把macOS arm64开发缓存当成Windows/Linux发行包。
- `npm audit`发现锁定Effect 4.0.0-beta.83的中等风险Cookie属性注入公告 [GHSA-chp3-j5qr-2vfr](https://github.com/advisories/GHSA-chp3-j5qr-2vfr)。办公引擎不使用Cookie API，但依赖链仍存在公告。未盲目降级OpenCode SDK或跨版本升级Effect；企业发行门槛仍须兼容性审查和修补。
- macOS方便预览：双击 `office/Preview.command`，会在新的本地目录生成合成数据示例，并打开经营看板与文件夹。不会启动服务或改变模型配置。
- 新工具 `office_capabilities` 返回版本化协议和完整可运行样例，安装到任意项目后无需靠猜测JSON字段或定位源码。
