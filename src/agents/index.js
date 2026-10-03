/**
 * 领域提示词与 Agent 实现
 * ---------------------------------------------------------------
 * 对应 HelloAgents 框架 agents/ 目录：
 *   react-agent.js        ReActAgent —— 默认主力
 *   plan-solve-agent.js   PlanAndSolveAgent —— 复杂多步分析先规划
 *   reflection-agent.js   ReflectionAgent —— 结果自查与纠错
 */

const { Agent } = require('../core/agent');

/**
 * 药物经济学领域系统提示词
 * 分层组织：角色 → 教学原则 → 工具使用规范 → 表达规范
 * 教学原则是专门为"非计算机专业学生"设计的，LLM 天然擅长这件事。
 */
const PE_SYSTEM_PROMPT = `你是「药物经济学智能体」，一位同时具备药学、临床与卫生经济学背景的教师助理，服务对象是药学与经济学专业的学生。

## 你的角色
帮助学生理解概念、掌握方法、完成计算、检查作业。所有回答都要假设读者**没有经济学基础**。

## 教学原则（必须遵守）
1. **先说人话，再上公式。** 任何概念先用一句生活化的话解释，再给定义，最后给公式。
2. **公式必须配数字例子。** 学生记不住符号，但记得住算例。
3. **区分"是什么 / 为什么 / 怎么做"。** 不要把三者混在一起讲。
4. **主动指出易错点。** 学生最容易踩的坑要主动提醒，而不是等他们做错。
5. **不确定就说不确定。** 参数取值、阈值、指南要求若无法从知识库确认，明确说"此处需查证原始文献"，不要编造数字。
6. **区分规范与惯例。** 例如"CHEERS 2022 要求报告 ICER"是规范，"我国通常用 5% 折现率"是惯例，规范与惯例的确定性不同。

## 工具使用规范
- **凡涉及计算，必须调用工具**，不要用心算给出数值。你没有心算的可靠性。
- 涉及概念、定义、指南、文献出处时，调用 search_knowledge_base。
- 遇到专业缩写（QALY、ICER、PSA、CEAC、INMB、DSA、NICE…），先调用 explain_term 确认含义再作答。
- 工具返回失败时，读懂错误信息并修正参数后重试，不要把错误原样抛给用户。
- 若用户的问题偏向完整分析任务（"帮我分析某新药"），先列出分析步骤，再逐步执行。

## 表达规范
- 使用 Markdown 表格承载对比数据和计算步骤。
- 关键数字加粗。
- 公式用行内代码或独立成行，写清每个符号代表什么。
- 结尾给一句"记住这句话"式的总结。
- 全文不要出现"作为一个AI"之类的表述，直接给内容。
- 中文回答，术语首次出现时给出英文全称与缩写。`;

/** ReActAgent：思考 → 调工具 → 观察 → 继续，直到给出答案 */
class ReActAgent extends Agent {
  constructor(name, llm, opts = {}) {
    super(name, llm, {
      ...opts,
      systemPrompt: opts.systemPrompt || PE_SYSTEM_PROMPT,
      maxSteps: opts.maxSteps ?? 8,
    });
  }

  buildSystemPrompt(runOpts = {}) {
    return this.contextBuilder.buildSystemPrompt({
      basePrompt: this.systemPrompt,
      chunks: runOpts.chunks || [],
      sessionState: this.sessionState,
    });
  }

  /**
   * 模型不可用时降级到离线知识引擎，保证界面永远有输出。
   * 这是"零配置可用"的关键：没有 API Key 也能得到有依据的回答。
   */
  onModelError(err, task, runOpts) {
    super.onModelError(err);
    const engine = this.sessionState.offlineEngine;
    if (!engine) return null;
    const res = engine.answer(task, { chunks: runOpts.chunks || [] });
    return res.text;
  }
}

/**
 * PlanAndSolveAgent：复杂任务先出计划，再逐步解决
 * 适合"帮我完整评估一个新药是否值得进医保"这类多阶段任务。
 */
class PlanAndSolveAgent extends Agent {
  constructor(name, llm, opts = {}) {
    super(name, llm, {
      ...opts,
      systemPrompt:
        opts.systemPrompt ||
        `${PE_SYSTEM_PROMPT}\n\n## 本次任务采用「先规划、再求解」模式\n` +
          `面对多步骤的分析任务，你必须：\n` +
          `1. 先输出一个编号的分析计划（用列表），让学生看到你要做什么；\n` +
          `2. 再按计划逐步执行，每步调用相应工具；\n` +
          `3. 最后汇总结论，并说明哪些步骤依赖了假设。`,
      maxSteps: opts.maxSteps ?? 12,
    });
    this.plan = null;
  }

  buildSystemPrompt(runOpts = {}) {
    const base = this.plan ? `${this.systemPrompt}\n\n## 本次任务的既定计划\n${this.plan}` : this.systemPrompt;
    return this.contextBuilder.buildSystemPrompt({
      basePrompt: base,
      chunks: runOpts.chunks || [],
      sessionState: this.sessionState,
    });
  }

  /** 一次运行：先生成计划，再求解 */
  async runWithPlan(task, runOpts = {}) {
    if (this.llm.available) {
      try {
        const planOut = await this.llm.chat({
          messages: [
            { role: 'system', content: '你是一位药物经济学分析专家。请为一个药经济学分析任务列出 3-6 步的执行计划，每步一句话，不要展开。' },
            { role: 'user', content: task },
          ],
        });
        this.plan = planOut.content;
        this.onEvent({ type: 'plan', agent: this.name, content: this.plan });
      } catch {
        // 规划失败不阻塞，退化为直接求解
        this.plan = null;
      }
    }
    return this.run(task, runOpts);
  }
}

/**
 * ReflectionAgent：产出后再自查一遍，专门抓数值错误与逻辑漏洞
 * 学生的作业里最常见的问题就是公式用错、单位混乱、增量符号搞反。
 */
class ReflectionAgent extends Agent {
  constructor(name, llm, opts = {}) {
    super(name, llm, {
      ...opts,
      systemPrompt:
        opts.systemPrompt ||
        `${PE_SYSTEM_PROMPT}\n\n## 本次任务附加「反思」环节\n` +
          `给出结论后，你必须再自检一遍以下要点，并把修正直接融入最终回答：\n` +
          `- 公式方向是否搞反（ICER 是 Δ成本/Δ效果，不是反过来）\n` +
          `- 增量成本与增量效果的符号是否与描述一致\n` +
          `- 单位是否统一（成本为元、效果为 QALY、ICER 为元/QALY）\n` +
          `- 是否把"相关关系"说成了"因果关系"\n` +
          `- 是否遗漏了对照方案\n` +
          `- 结论是否与计算结果一致（例如算出 INMB<0 却说新方案更优）`,
      maxSteps: opts.maxSteps ?? 8,
    });
  }

  async run(task, runOpts = {}) {
    const result = await super.run(task, runOpts);
    // 反思：把已有答案交给模型再校一次
    if (this.llm.available && result.text) {
      try {
        const chk = await this.llm.chat({
          messages: [
            { role: 'system', content: '你是药物经济学方法学审稿人。指出下面回答中的数值错误、公式误用与逻辑漏洞。若无问题，回复"通过"。' },
            { role: 'user', content: result.text.slice(0, 6000) },
          ],
        });
        if (chk.content && !/^通过\s*$/.test(chk.content.trim())) {
          this.onEvent({ type: 'reflection', agent: this.name, content: chk.content });
          this.lastReflection = chk.content;
        }
      } catch {
        /* 反思失败忽略 */
      }
    }
    return result;
  }
}

module.exports = { ReActAgent, PlanAndSolveAgent, ReflectionAgent, PE_SYSTEM_PROMPT };
