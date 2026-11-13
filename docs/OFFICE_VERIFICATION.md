# 办公引擎迭代2–4验收记录

验证日期：2026-11-13；macOS arm64；独立工作树；Node22.22.2、Bun1.2.18、Python3.13；没有读取用户API凭据或调用公司内网模型。

## 验证范围

- 完整旧仓库 build、办公adapter build、TypeScript typecheck通过。
- 完整 Bun 测试：59通过、1跳过（Windows原生ACL）、0失败，含9项办公路径、权限拒绝、安装、取消和协议发现端到端测试。
- Python单元/真实文件回归共81项全部通过：Excel27、复杂图表13、HTML21、资源边界9、CLI4、公开语料缺陷/快照复现7，无expectedFailure。
- 真实OpenCode1.19.5后端：隔离HOME和临时项目，四个工具注册，模拟模型实际调用HTML生成成功；不是GLM5.3质量验证。
- 五个独立业务场景各1440/768/390视口和额外空数据/长中文/多序列/负值压力样本通过。自动检查网络请求、控制台、溢出、裁切、表caption、重复ID、键盘开合；截图目视覆盖多种桌面/手机。
- 各场景A4 PDF已生成，检查文本尾部和抽样页面，无发现遮挡；部分末页留白仍需后续排版优化，不称全部分页已精排。
- 四个Python依赖从本地wheelhouse在新环境 `--no-index --require-hashes` 安装成功。固定版本许可证原文齐全，哈希清单已记录。

## 独立review发现并修复

1. 运行中取消没有传播给Python：已传播AbortSignal、杀掉子进程，测试确认停止后不会发生延迟文件发布。
2. 巨大合并区域绕过存储cell预算：XML预检累计存储cell与合并展开面积，在openpyxl加载前拒绝。
3. 合法非标准worksheet/chart文件名被跳过：按真实XML部件和relationships识别，增加重命名回归。
4. 大表只能读前部：增加精确sheet筛选与1-based起始窗口、逐行采样覆盖证据和截断原因。
5. 图表系列与轴语义丢失：保留name/categories/values/x/y、bar方向、grouping、axis ids、cross axis、number format/scaling等；复杂组合仍给明确限制。
6. 未知生成字段被静默忽略：所有输入对象未知字段拒绝；散点X和pie值增加语义验证。
7. 新项目Agent找不到协议：新增office_capabilities，返回版本化字段和可运行样例，实际生成回归通过。
8. 五场景样例同质、手机横滚不明显：改成独立经营/研究/项目/比较/运营信息结构并添加滚动提示、空态和键盘支持。

## 仍未达到的发行门槛

- 未安装用户现有OpenCode项目；未用真实GLM5.3、企业文件、Windows/Linux内网实机验收。
- 不支持XLS/XLSB/加密文件、公式计算、VBA执行、任意已有工作簿无损编辑。读取复杂对象不等于能修改它。
- Effect已升至beta.103并保留原TOML/Zod补丁，Cookie注入回归与真实宿主兼容通过；npm audit为0已知告警，不代表不存在未知漏洞。
- Python离线依赖齐备，不等于所有操作系统的Node/npm/浏览器/CJK字体离线包已齐备。
- 本轮只作本地提交，不推送、合并或发布。后续迭代应保持这些边界。

## 第三轮增量证据

- 合成复杂图表矩阵 `office/evidence/chart-matrix/manifest.json`：13/13，无expectedFailure；保留每个xlsx、解析report和hash。
- `office/evidence/iteration3/`：默认关闭/展开details打印共10份PDF文本校验、15视口与实际键盘横滚检查；null单元格额外样本。
- `office/evidence/benchmark/report.json`：1k/10k/100k单元格单进程基准，真实内存/时间，非生产性能保证。
- `office/evidence/npm-audit-effect103-patched.json`：新锁文件0已知漏洞；不涉及用户旧node_modules或Desktop内置依赖。
- 已修复新发现的hyperlink/sqref资源膨胀、XML节点洪泛、图表越界丢失、现代chartEx漏报、公式标题和隐藏数据语义遗漏，以及打印QA掩盖默认关闭内容的问题。

Effect升级后既有调度器真实隔离集成也已通过：完成、等待审批、中止、重启恢复，模型请求2次且无重复提交。脱敏汇总与源码哈希见 `docs/evidence/office-round3.json`。

## 第四轮公开语料与离线产品化

- 外部维护的Apache POI公开测试语料，固定commit e0658769cb7f7da25ec09178805e04069dedc6ed，15文件共859,162字节，Git blob/SHA256与Apache-2.0根许可/NOTICE记录齐全。二进制仅本地评估，不提交/再分发。见 `docs/evidence/public-corpus-manifest.json`。
- 15/15结构对照通过，0异常/超时；含7个原生chart部件，源32个array公式只对采样窗口内逐项比较，不宣称32项全覆盖或真实Excel计算正确。
- 这些外部样本找到了自产样例未暴露的问题：ArrayFormula/DataTableFormula对象序列化丢表达式/ref、chartsheet记录遗漏、rich-text标题run间插空格、解析库unsupported警告未透传。已修复，并增加原创最小复现，不复制外部二进制。
- Excel现在从同一个有界字节快照读取公式与缓存；并发替换文件测试确认不会混入后版本缓存。JSON报告在编码过程中限8MiB，超限不给半截结果。
- 10份多样HTML内容×3视口通过；24列运营表打印转字段卡，末列不丢；60里程碑完整。引用链支持人工http(s)链接，不自动访问，不冒称核实。5套压力样例明确为原创合成内容。
- `office/qa-print.py`＋`.print-check.json`使打印关键文字检查可重复；缺Poppler明确blocked，文字通过不代表视觉分页已完美。
- `office/offline_rehearsal.py`可对精确已提交快照使用本地npm cache和wheelhouse，全新目录完成离线安装、构建、测试、dry-run/apply模拟安装和浏览器QA。需预置工具/浏览器，不把本机演练冒充公司内网或跨平台验收。
- 较大工作簿测试把原生line图放在末100行：10万cell的图表引用A9901:A10000/B9901:B10000与缓存均核对，位于1千cell输出采样区之外。单元格未用read_only切换；OOXML图表通路独立，超资源预算明确拒绝。

## 第五轮受限浏览器验收与证据真实性

- 新增`office_validate_html`，与既有生成/解析协议一起可被安装后的Agent发现。真实隔离OpenCode后端五工具注册、合成模型三次请求，HTML生成后实际调用浏览器验收成功；不是GLM或公司内网测试。
- 最终全量Bun 76通过、1个Windows原生ACL跳过、0失败；Python81通过。新增静态浏览器/工具测试17项，覆盖权限拒绝、路径逃逸、取消子进程树、缺浏览器、结构化失败及资源预算。
- 独立审查真实复现并修复：子frame绕过顶层DOM/脚本统计、屏幕短但打印107页、强制分页160页仍低DOM高度。静态模式解析前拒绝嵌入上下文，默认/展开打印各自重新检查，页数硬上限且疑似截断不通过。Chromium自身sandbox显式开启，无自动降级。
- 目视发现新截图逻辑曾把底部viewport误称完整页面，修复后PNG真实IHDR尺寸与声明一致；顶部hero像素回归绑定内容。内部键盘滚动残留也修复，截图前全部滚动区域两次稳定归零，首列表格像素回归通过。错误的iteration5/iteration5-final证据保留作调试，不作最终截图交付。
- 最终证据为`office/evidence/iteration5-release/`，10样例×3视口全部静态passed，源HTML SHA256绑定。五压力样例默认PDF关键文字检查通过。脱敏汇总为`docs/evidence/office-round5.json`。
- `passed`仍不代表审美、业务正确或任意脚本应用可用；截图应人工审阅，部分长页打印留白与不同操作系统字体仍需目标环境验证。工具无完整操作系统文件/网络沙箱保证。
