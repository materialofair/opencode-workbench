# 办公引擎迭代2验收记录

验证日期：2026-11-13；macOS arm64；独立工作树；Node22.22.2、Bun1.2.18、Python3.13；没有读取用户API凭据或调用公司内网模型。

## 验证范围

- 完整旧仓库 build、办公adapter build、TypeScript typecheck通过。
- 完整 Bun 测试：58通过、1跳过（Windows原生ACL）、0失败，含8项办公路径、权限拒绝、安装、取消和协议发现端到端测试。
- Python单元/真实文件回归包含Excel27、HTML13、CLI2。最终准确计数见本地 `office/evidence/python-final.txt`。
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
- 锁定Effect beta.83仍有moderate Cookie属性注入公告。当前办公代码未使用该API，但正式发行前需兼容修补/上游升级评估，不能称依赖无漏洞。
- Python离线依赖齐备，不等于所有操作系统的Node/npm/浏览器/CJK字体离线包已齐备。
- 本轮只作本地提交，不推送、合并或发布。后续迭代应保持这些边界。
