# AVS 视觉工坊三仓链路核查

核查日期为 2026-11-27。AVS 的验收基线为视觉工坊 1.2.5，角色视觉档案为 V4.2.1。

## 三个项目怎样从楼层走到图

| 阶段 | 智库 0.9.19 | 柏宝绘 0.3.27 | 魔女画匣 0.1.0 |
| --- | --- | --- | --- |
| 输入 | 可按规则选取正文，混入的状态与附注可排除。后处理发送正文、选段和候选角色资料。 | 清洗发送副本，为可用段落保留 P 编号和原行号。角色卡、角色外貌和世界书可分层加入。 | 保存楼层快照，从合法叙事区域找插入点。指定插图可锁定单点或一个明确范围。 |
| 模型输出 | 后处理输出 `images`。单图含原文锚点、场景、构图、动作关系、人物和站位。另有正文内标记模式。 | 单图含 `position`、`tag`、可选 `nl`、人物分栏和画幅。角色资料变化与图片条目有不同字段。 | 模型按配置的预设结构返回配图数组。程序验证插入点、已选范围和回复身份，再插入画框标记。 |
| 编译 | 角色候选按名字、别名或 ID 与资料匹配。主要场景词与人物词各自组装。支持逐图编辑、预览实际请求和角色参考。 | 分开整理 Base、人物标签和可选自然语言，把画师、默认质量或负向配方在本地叠加。排序、标签规范、归属和正文证据在预设中明确。 | 模型任务和配图标记分离。识别 NAI 的 `|` 人物分栏和 `~` 人物负向，随后展开角色锚点和服装引用，最后叠加全局画风。 |
| 生图与回图 | 官方、酒馆和第三方通道各有入口。识别 ZIP、PNG、二进制流和 JSON 等回包；记录实际请求及回包类型；部分服务端错误有条件重试。 | NAI 适配器独立构造请求和解包。队列控制节奏，特定 429、5xx 或网络失败有退避。构图和保存通过槽位及原文锚点衔接。 | 冻结当前配置再入 FIFO 队列。读取和验证 ZIP、图像、Base64、结构化包装或图床链接；回图写到该标记的画框与历史。 |
| 状态反馈 | 场景可编辑和重绘，问题记录区分实际请求与站点回包。 | 被改稿或过期的楼层结果不会静默写进另一条回复，图片槽位与保存记录分离。 | 提示词处理与绘图分别有等待、失败、完成状态。自动绘图对已完成记录去重，切聊天会取消旧任务。 |

### 源码位置

- 智库固定在 `20f56f1abd73f0e245c2f36ef873a00bcb09b74f`。正文取样、画面请求、校验与人物编译，以及 Native 请求和第三方回图分布在这些源码中。[摘录](https://github.com/ruoege49-ship-it/zhiku-tavern-helper/blob/20f56f1abd73f0e245c2f36ef873a00bcb09b74f/src/excerpt.js) · [画面计划](https://github.com/ruoege49-ship-it/zhiku-tavern-helper/blob/20f56f1abd73f0e245c2f36ef873a00bcb09b74f/src/illustration-plans.js#L78) · [请求与回图](https://github.com/ruoege49-ship-it/zhiku-tavern-helper/blob/20f56f1abd73f0e245c2f36ef873a00bcb09b74f/runtime.js#L6484)
- 柏宝绘固定在 `b13efab4588964b5cf91114718cc79fb9bac5400`。位置映射、提示词规范、兼容解析和 NAI 请求分属各模块。[清洗](https://github.com/wuhehen176/ST-BaiBai-Image/blob/b13efab4588964b5cf91114718cc79fb9bac5400/src/autoTag/clean.ts#L229) · [NAI 提示词规范](https://github.com/wuhehen176/ST-BaiBai-Image/blob/b13efab4588964b5cf91114718cc79fb9bac5400/src/state/prompts/naiV5Spec.ts) · [计划解析](https://github.com/wuhehen176/ST-BaiBai-Image/blob/b13efab4588964b5cf91114718cc79fb9bac5400/src/autoTag/protocol.ts#L195) · [NAI 适配器](https://github.com/wuhehen176/ST-BaiBai-Image/blob/b13efab4588964b5cf91114718cc79fb9bac5400/src/backends/nai.ts#L361)
- 魔女画匣固定在 `2ab687841532c0a0aed91c1442fe63dfa5ccfe24`。核心是插入点验收、可复用人物锚、一次只对当前画框发送的独立生图任务。[楼层处理](https://github.com/Elainadesne/witch-paintbox/blob/2ab687841532c0a0aed91c1442fe63dfa5ccfe24/src/chat-processor.ts) · [插入点契约](https://github.com/Elainadesne/witch-paintbox/blob/2ab687841532c0a0aed91c1442fe63dfa5ccfe24/src/image-insertion.ts#L176) · [人物与服装锚](https://github.com/Elainadesne/witch-paintbox/blob/2ab687841532c0a0aed91c1442fe63dfa5ccfe24/src/image-prompt.ts#L52) · [NAI 请求](https://github.com/Elainadesne/witch-paintbox/blob/2ab687841532c0a0aed91c1442fe63dfa5ccfe24/src/novelai.ts#L177) · [回图解包](https://github.com/Elainadesne/witch-paintbox/blob/2ab687841532c0a0aed91c1442fe63dfa5ccfe24/src/image-response.ts#L356)

三个固定提交未找到明确的仓库级复制许可。AVS 按可观察接口与任务结构自行实现，复用了自身旧版的 MessagePack 解析路径。三个项目对坐标、额外参数与重试的做法各不相同。AVS 保留原线路和参数配置、单图单请求与现有草稿界面。

## AVS 已落地的流程

1. 从指定楼层或最新有效 AI 楼层取叙事副本，排除常见规划、思考、状态栏和选项块。楼层版本标识和旧图库匹配使用原有文本。
2. 提示词服务写一个镜头，按可见人数、景别、共同动作、场景和光线写全局词。各人物单独写固定外貌、此刻衣着、动作、表情和目光。正文定位句只有出现在原内容里才使用。
3. 将解释文字、代码围栏或 SSE 作为外层包装处理。只有通过字段验收的完整对象才能生图。输出上限、拦截、缺字段与网关回网页会分别报错。
4. 正常出图仍先保存可编辑草稿。按模型发单图 Native 请求。V4.5 和 V5 的原生版本字段和人物分栏上限分别校验。Native V5 二进制流必须含最终事件，缺最终帧会报错。ZIP、直接图像、Base64 和已支持的 JSON 包装继续可用。
5. 余额不足时显示当前请求所需与可用 Anlas。修复额度或参数后，可从现有草稿单独重试生图。工坊维持原有图库和楼层配图预览，原聊天正文无需改写。

一个最小构图原型。源句为「她抬起提灯照亮台阶，守在门边的人抬手挡住眩光。」场景写两人、能容纳台阶和门的景别、深夜回廊和暖灯。第一人物写她的衣着、举灯和目光，第二人物写守门人的衣着、抬手遮光和站位。这样场景能读出因果，每条人物词也有确定归属。两种模型的字段主干相同，V4.5 优先短标签，V5 可在短标签后补一句必要的空间关系。

## 已验证与实机验收边界

- 在旧 1.2.4 复现了规划块混入、合法对象前有说明即失败、二进制回图无法读取和 402 只显示原始 JSON。
- 智库选跑的 7 个脚本、柏宝绘选跑的 174 个用例、魔女画匣选跑的 35 个用例均通过。项目、分支和统计口径见上文，运行均采用本地模拟数据。
- AVS 已验证常规 JSON、解释包裹、SSE、图像流缺最终帧、ZIP、Base64、第三方回图包装、额度失败、双模型请求和两种安装入口。
- 另在 360 像素手机视口的 Chromium 中，分别运行 GitHub 扩展和酒馆助手内嵌工坊。用模拟提示词和生图接口验证楼层清洗、4.5 与 V5 双模型按钮、V5 最终帧预览，以及 402 后使用原草稿出图时仅重发一次生图请求。
- 本轮通过的是可复现的接线与协议回归。尚无真实账户生成结果，无法评价画风提升、同人还原度或单张 Anlas 成本。实机画质验收应固定模型和种子，同一段正文比较全身、互动近景、男女同框和空镜，记录主体、动作、衣着归属与画面完成度。
