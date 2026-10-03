# 药物经济学智能体（Pharmacoeconomics Agent）

面向**药学与经济学专业学生**的零配置药物经济学学习与计算助手。

> 目标用户不熟悉电脑操作，因此本项目在三个方向上做了明确取舍：
> **零安装**（不依赖 Python / pip / 数据库 / Node）、**零配置**（不填任何东西即可使用）、
> **大触控 + 有出处的解释**（不猜、不编、每条结论可回溯）。

---

## 一、三个设计来源

| 维度 | 来源 | 本项目的落地方式 |
| --- | --- | --- |
| Agent 架构 | [Datawhale《Hello-Agents》](https://github.com/datawhalechina/hello-agents) 与 [HelloAgents 框架](https://github.com/jjyaoao/helloagents) | 按其 `core/ tools/ context/ agents/ memory/ observability/ skills/` 分层移植（见下表） |
| 知识库 | [Wikipedia: Pharmacoeconomics](https://en.wikipedia.org/wiki/Pharmacoeconomics)、CHEERS 2022、中国药物经济学评价指南、NICE PMG36、WHO 2003、ISPOR、Drummond 教材 | 15 篇深度语料 + 32 条术语 + 15 个公式 + 4 份检查清单，每条标注出处 |
| 界面 | [Material Design 3](https://m3.material.io/) | 完整 M3 角色化色彩/排版/形状/高度/动效令牌，并针对非技术用户加固 |

---

## 二、HelloAgents 架构移植对照

| HelloAgents（Python） | 本项目（JavaScript / Electron） | 说明 |
| --- | --- | --- |
| `core/llm.py` + `core/llm_adapters.py` | `src/core/llm.js` + `src/core/llm-adapters.js` | 三协议适配（OpenAI 兼容 / Anthropic / Gemini），保留按 `base_url`+`key` 格式自动识别 provider 的逻辑 |
| `core/agent.py`（Function Calling 架构） | `src/core/agent.js` | 同一套「思考 → 调工具 → 观察 → 继续」主循环，含最大步数保护、熔断、流式事件、可观测埋点 |
| `tools/response.py`（ToolResponse） | `src/tools/registry.js` 中的 `ToolResponse` | 统一成功/失败结构，**失败也返回可被模型看见的文本**以便自我修正 |
| `tools/registry.py` | `src/tools/registry.js` 的 `ToolRegistry` | 支持函数式 / 描述对象注册；含 `ToolRegistryLike`（对应 ToolFilter 子代理白名单） |
| `tools/circuit_breaker.py` | `src/tools/circuit-breaker.js` | 连续失败自动短路，避免界面一直转圈 |
| `context/token_counter.py` | `src/context/token-counter.js` | 启发式 token 估算，中英文分别加权，**不依赖任何 tokenizer 库** |
| `context/history.py` | `src/context/history.js` | 按预算裁剪并保留完整最后一轮（成对裁剪，不留孤立 tool 结果） |
| `context/truncator.py` | `src/context/truncator.js` | 截断时保留头尾并标注省略字数 |
| `context/builder.py` | `src/context/builder.js` | 把「系统提示 + 检索片段 + 会话状态」组装成最终 prompt |
| `agents/react_agent.py` | `src/agents/index.js` 的 `ReActAgent` | 默认主力，附药物经济学领域提示词 `PE_SYSTEM_PROMPT` |
| `agents/plan_solve_agent.py` | `PlanAndSolveAgent`（`runWithPlan()`） | 复杂任务先出计划再逐步执行 |
| `agents/reflection_agent.py` | `ReflectionAgent` | 产出后自检公式方向、符号、量纲、结论一致性 |
| `core/session_store.py` | `src/memory/session-store.js` | **改用 JSON 文件而非 SQLite** —— 零安装硬约束 |
| `observability/trace_logger.py` | `src/observability/trace-logger.js` | JSONL 轨迹日志，可在「设置」页查看 |
| `skills/loader.py` | `src/skills/loader.js` | Skill 知识外化，exe 旁 `skills/` 目录可由用户自行增补 |

### 为何用 JavaScript 而非 Python

用户明确要求"下载后点击即用，不能再额外安装 Python / pip / SQL"。Python 版需要随包捆绑解释器或 PyInstaller 打包（约 60–100 MB 且易被杀软误报）；Electron 的 Chromium + Node 运行时可直接分发为单文件 exe，**且 GIL/事件循环模型天然适合 I/O 密集的 LLM 流式调用**。

---

## 三、目录结构

```
PharmaEconAgent\
├── package.json
├── 使用说明.txt                面向最终用户
├── scripts\
│   ├── build-knowledge.js     语料 + 结构化数据 → dist/kb.json
│   ├── make-icon.js           零依赖 PNG 生成（应用图标）
│   ├── make-release.js        组装发布目录
│   ├── selftest.js            43 项端到端自检
│   └── screenshot.js          界面截图（人工校对）
├── knowledge\
│   ├── corpus\*.md            15 篇深度语料（带 frontmatter）
│   └── data\*.js              主题 / 术语 / 公式 / 清单 / 资源 / 路径 / 示例
├── dist\kb.json               构建产物（打包进 asar）
├── src\
│   ├── core\                  LLM 适配 + Agent 基类
│   ├── agents\                ReAct / Plan-and-Solve / Reflection
│   ├── tools\                 ToolResponse / Registry / CircuitBreaker / 内置工具
│   ├── context\               TokenCounter / HistoryManager / Truncator / Builder
│   ├── rag\                   中文 BM25（无分词库）
│   ├── knowledge\             知识库加载 + 离线问答引擎
│   ├── domain\math.js         药物经济学数学内核（纯函数、可复现）
│   ├── memory\, observability\, skills\
│   └── main\                  Electron 主进程 / IPC / preload
└── renderer\                  前端（M3 设计令牌 + 组件 + 视图）
```

---

## 四、领域工具（15 个）

知识检索与解释：`search_knowledge_base`、`explain_term`、`list_topics`、`get_checklist`、`build_report`

数值计算（**全部确定性、可复现，不经过 LLM 心算**）：
`calc_qaly`、`calc_icer`、`calc_inmb`、`calc_psa`、`calc_owsa`、`calc_discount`、`calc_bia`、`calc_decision_tree`、`calc_cba`、`calc_coi`

### 几处刻意的设计决策

1. **PSA 使用可播种的确定性 PRNG**（mulberry32）。同一 `seed` + 同一参数必然得到同一结果 —— 教学场景下学生反复调参必须能看到「只有参数变化带来的差异」，否则会怀疑软件在乱数。
2. **被支配方案强制拦截**。当 `ΔE < 0 且 ΔC > 0`（西南象限）时，工具直接判定"不应采用"，**无论 ICER 算出来多好看**。这是学生最常见的错误（「ICER 是负数所以更划算」），必须在工具层面拦住，而不是只在知识条目里提一句。
3. **先判象限，再谈阈值**。`calc_icer` 的判定顺序固定为：平面象限 → 象限语义 → 阈值比较。工具层面不允许跳过第一步。
4. **中文检索用一元 + 二元组合切分**，不引入 jieba 等分词库。实测对 `QALY`、`ICER`、`PSA` 这类专业缩写召回良好。
5. **问句净化**。「QALY 是什么意思？能用一个例子讲讲吗？」中的"是什么意思/举个例子"会生成大量无意义二元组，实测会把无关文档排到第一。`normalizeQuery()` 先剥离套话再做检索。
6. **字段加权三路 BM25**（标题别名 ×3.2 / 标签 ×1.6 / 正文 ×1）。专有名词命中标题应显著压过只在正文偶然出现的文档。

---

## 五、零安装是怎么做到的

| 约束 | 做法 |
| --- | --- |
| 不装 Python / pip | 全栈 JavaScript，Electron 自带 Node 运行时 |
| 不装数据库 | 知识库 = 单个 JSON；检索 = 内存 BM25；会话 = JSON 文件 |
| 不装 Node | 打包为 portable exe，运行时含全部依赖 |
| 不需要联网 | 默认离线模式，问答走内置检索式引擎，**有依据且标注出处** |
| 不需要配置 | `offline` 是默认 provider；API Key 为可选增强 |

### 离��� ≠ 弱化

没有 API Key 时走 `OfflineEngine`：意图识别（6 类）→ 字段加权检索 + 意图先验 → 结构化组装（直答 + 知识条目 + 出处 + 提示 + 可点击追问）。**它不会编造数字**——所有内容都来自知识库条目，且每条都带 `source` / `url`。

---

## 六、界面：M3 + 面向零基础用户的加固

严格遵循 M3 令牌（角色化色彩、type scale、shape scale、elevation 0–5、motion tokens、state layer），并做以下**超出规范的加固**：

| 项 | M3 规范 | 本项目 | 原因 |
| --- | --- | --- | --- |
| 触控目标 | 48dp | 按钮 48px，主操作 56px，输入框 ≥48px | 目标用户不熟悉精细操作 |
| 正文字号 | 16px | **17px** | 长时间阅读中文的舒适下限 |
| 描边 | 1px | **2px** | 高对比环境下更清晰 |
| hover 状态层 | 8% | **10%** | 变化更易察觉 |
| disabled 内容 | 38% | **45%** | 太淡等于看不见 |
| 导航栏 | 80dp | **96dp** | 容纳中文字标签不换行 |
| 图标 | Material Symbols | **内联 SVG + 强制文字标签** | 字体图标无障碍差、体积不划算；纯图标控件对非技术用户是理解障碍 |

唯一允许"只有图标没有文字"的控件是关闭/主题/帮助按钮，且都带 `aria-label` + Tooltip。

其他可读性处理：输入框使用**常驻标签**（不用 placeholder 代替）、状态变化必须有文字说明（不只靠颜色）、滚动条加宽到 14px 便于鼠标拖动、支持 `prefers-reduced-motion` 与 `prefers-contrast`。

---

## 六·五、portable 单文件模式的一个坑（以及怎么绕）

NSIS 自解压启动器会把应用解到 `%TEMP%\XXXX\` 再运行。此时
`__dirname`、`app.getPath('exe')`、`process.execPath` **全部指向临时目录**。

如果照它们定位「我的报告」，用户导出的报告会在系统清理临时目录时一起消失；
放在 exe 旁边的「知识库」「skills」也会永远读不到。

`resolveExeDir()` 的处理顺序：

1. `process.env.PORTABLE_EXECUTABLE_DIR` —— electron-builder 的 portable 启动器会设置它指向启动器自身目录
2. `process.env.PORTABLE_EXECUTABLE_FILE` 的 dirname
3. 兜底 `path.dirname(app.getPath('exe'))`

这个 bug 是被**启动自检**（`src/main/diagnostics.js`）抓出来的：自检会检查
`exeDir` 是否意外落在 `%TEMP%` 下，并对 `我的报告` 目录做一次真实写入探测。
它同时也是发给用户的报障材料 ——「设置 → 运行自检」给出结果表并落盘日志。

---

## 七、安全设计

渲染进程完全禁用 Node（`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`），所有能力通过 `preload.js` 暴露的 **24 个具名方法**访问。知识库内容与模型输出都视为不可信输入：

- Markdown 渲染前统一 HTML 转义，杜绝 XSS
- CSP 限制 `default-src 'none'`
- 外链一律交给系统浏览器，应用内拒绝导航
- 配置损坏时退回离线模式，而不是崩溃

---

## 八、开发命令

```bash
npm install                # 一次性（构建机需要，不是终端用户）
npm run kb                 # 重建知识库 → dist/kb.json
npm run icon               # 重新生成应用图标
npm run dev                # 开发模式运行
npm run selftest           # 43 项端到端自检（真实 Electron 窗口）
npm run shots              # 生成界面截图到 shots/
npm run dist               # 打包 → release/药物经济学智能体.exe
node scripts/make-release.js   # 组装发布目录 → D:\药物经济学智能体\
```

自检覆盖：渲染进程无报错、10 个视图全部正常、计算器端到端、**方法学正确性反向验证**（被支配方案不得声称"具有成本效果"）、离线问答、知识库规模、渲染进程无 Node 权限。

---

## 九、许可与出处

- 知识条目综合自维基百科（CC BY-SA 4.0）、CHEERS 2022（BMJ 2022;376:e067975）、《中国药物经济学评价指南（2020 中英双语版）》（T/CPHARMA 003-2020）、NICE PMG36、WHO《Making Choices in Health》(2003)、ISPOR Good Practices、EVIDEM 框架（Goetghebeur 等 2008）、Drummond 等《Methods for the Economic Evaluation of Health Care Programmes》。每条内容在「知识库」页可查看其独立出处。
- Agent 架构参考 Datawhale《Hello-Agents》与 HelloAgents 框架，遵循 CC BY-NC-SA 4.0。
- 界面遵循 Material Design 3 规范。

> 本软件为**学习辅助工具**，不构成医疗、用药或医保决策建议。
