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
bun test ./tests/office.test.ts
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
- 第三轮将Effect限定升级到4.0.0-beta.103，修复 [GHSA-chp3-j5qr-2vfr](https://github.com/advisories/GHSA-chp3-j5qr-2vfr)，并保留toml5.0.1/Zod4.6.7覆盖。新增Cookie字段注入拒绝回归、全量测试和隔离真实OpenCode链路通过；该锁文件npm audit为0已知告警，不是未知漏洞安全保证。
- macOS方便预览：双击 `office/Preview.command`，会在新的本地目录生成合成数据示例，并打开多场景导航与文件夹。不会启动服务或改变模型配置。
- 新工具 `office_capabilities` 返回版本化协议和完整可运行样例，安装到任意项目后无需靠猜测JSON字段或定位源码。

## 迭代3复杂文档与性能

- 13个独立复杂图表case涵盖组合/双轴、日期轴、堆叠、跨表、系列名和标题引用、隐藏数据/空值策略、空缓存、图片混排、特殊图表显式边界。现代chartEx以unsupported记录报告，不再称无图。原生输出锚点校验Excel网格边界与底层返回码，避免静默丢图。
- OOXML预检流式释放节点，同时限制XML节点、属性长度、sqref token、shared strings、style records，以及stored cells+merge/hyperlink范围展开的累计成本。这些预算共同生效，并在inspect返回/能力协议中可见。
- 打印独立数据表不依赖details是否展开；QA对默认关闭和展开状态分别打印、核对PDF文本，不通过修改状态掩盖遗漏。手机滚动检查实际键盘输入和最右边可达性。
- HTML与Excel输入对象严格拒绝未知字段；表格null是空白，不能变成0。图表特殊功能未支持时明确报错或warning。
- `office/benchmark.py`是可重复合成基准，不是容量承诺。单独进程、1k输出窗口，10万存储cell约1.2秒/123MiB峰值；原始report记录机器、版本、引擎hash、方法和每次结果。真实复杂公司文件仍需单独验收。

子进程仅继承必要系统路径/语言/临时目录变量，不继承无关API密钥和Python启动覆盖；这不是操作系统级完整沙箱。运行中取消或超时会终止子进程，可能留下新建临时文件，需检查后再重试，不承诺撤回已完成的输出。

## 外部语料与离线演练

[Apache POI固定测试语料](https://github.com/apache/poi/tree/e0658769cb7f7da25ec09178805e04069dedc6ed/test-data/spreadsheet)用于外部结构对照。15份通过不是任意公司工作簿保证，也不是公式计算或Excel渲染验收。来源/许可/哈希见 `docs/evidence/public-corpus-manifest.json`；本仓库不包含这些二进制。数组/数据表公式输出formula_type与formula_metadata，chartsheet会显式记录，解析库未支持功能会在library_warnings报告。

完整离线安装演练（在开发源仓库运行，目标目录必须新建，runtime/browser需预置）：

```sh
python3 office/offline_rehearsal.py --output ../new-offline-run --npm-cache /path/to/prepared/npm-cache --wheelhouse office/wheelhouse --ref HEAD --browser-qa
```

该工具只归档指定commit，明确不包含未提交修改；不会联网下载或改用户全局配置。演练报告按stage记录，失败保留日志。Bun测试显式运行`bun test ./tests`，避免把演练副本重复计数。

可重复打印检查：`python3 office/qa-print.py print-default.pdf office/examples/stress/wide-operations.print-check.json`。使用预置Poppler；缺工具返回blocked，不假称通过。关键标记验证和视觉分页审阅是不同门槛。

## 静态HTML验收工具

`office_validate_html`读取项目内已有`.html`并写入全新证据目录；宿主分别询问read与edit权限。示例参数：`{"input":"reports/dashboard.html","output":"reports/dashboard-qa"}`。输出结构化状态、三个固定视口截图、默认状态/展开状态PDF与report.json。`office_capabilities`的`html`主题给出详细预算与边界。

- 页面JavaScript禁用，native details/滚动可检查；iframe/frame/object/embed保守拒绝。脚本应用返回unsupported，不能用本工具证明交互应用正确。
- 全新浏览器上下文、offline与全请求拦截、不使用用户浏览器profile，显式请求Chromium自身sandbox且不自动降级。这不是整个工具的操作系统文件/网络沙箱；不应将不可信HTML视为无风险输入。
- 需预置Node、锁定Playwright及匹配浏览器；不下载。管理员可设置绝对`OPENCODE_OFFICE_NODE`、`PLAYWRIGHT_BROWSERS_PATH`或`PLAYWRIGHT_CHROMIUM_EXECUTABLE`，工具参数不接受可执行文件或URL。缺浏览器返回blocked。
- HTML限4MiB、DOM限50,000节点、脚本内90秒/宿主95秒、每个证据限16MiB。超长截图、打印页数达到25页上限均不算通过；打印CSS另检查宽高与强制分页。截图/PDF可能是部分证据，请读status与warning，不只看文件存在。
- 输出目录不得已存在、不得越出项目；取消/错误可能留下部分新文件，检查后另选新目录重试。同用户进程并发恶意替换路径不在完整OS隔离保证内。
- `passed`只表示这些静态检查通过，截图仍须人工审美审阅，PDF分页、业务数据与内网GLM效果也分别验收。默认状态打印文件现在叫`print-default.pdf`。

## 交互与来源可用性增量

HTML可显式设置 `interaction:"first-party-table"`，table section可用`interactive:false`关闭个别表格交互。验收也必须显式传`mode:"first-party-table"`；默认static继续禁脚本。只执行固定本地运行时，预检exact单脚本及显示值一致性，工具独立响应头CSP不可被页面meta放宽。搜索、稳定排序、清空、匹配数和筛选后的全量打印被分别验证。任意脚本、重复/修改运行时或危险嵌入不支持。不是任意网页的安全沙箱或生成者身份认证。

Excel图表role的sources给出有界本地单元格来源、缓存差异和后续read_options；每次额外最多2000格、单引用100格。cache稀疏索引、多层标签与截断状态保留，不补零、不把保存值一致当作新鲜度。sheet.navigation给出半行恢复、续窗与尾部读取请求，options自带expected_source_sha256；源文件改变则拒绝合并版本。

新增`office_design_reference`，按需查询8域本地设计依据；设计组合详见`docs/OFFICE_DESIGN.md`。本地开发工作树已试装office-artifacts与office-visual-composition，不改其他项目、内网模型、全局权限或PPT技能。
