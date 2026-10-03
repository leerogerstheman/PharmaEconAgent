/**
 * Agent 基类（Function Calling 架构）
 * 移植自 HelloAgents 框架 core/agent.py
 *
 * 职责：
 *  - 维护系统提示与历史
 *  - 驱动「模型思考 → 调用工具 → 观察结果 → 继续思考」的主循环
 *  - 熔断保护、流式事件回调、可观测性埋点
 *
 * 子类通过实现 buildSystemPrompt() 与 onStep() 定制行为。
 */

const { LLM } = require('./llm-adapters');
const { ToolResponse } = require('../tools/registry');
const { CircuitBreaker } = require('../tools/circuit-breaker');
const { TokenCounter } = require('../context/token-counter');
const { HistoryManager } = require('../context/history');
const { ContextBuilder } = require('../context/builder');
const { TraceLogger } = require('../observability/trace-logger');

class Agent {
  /**
   * @param {string} name
   * @param {LLM} llm
   * @param {object} opts
   * @param {import('../tools/registry').ToolRegistry} opts.toolRegistry
   * @param {number} opts.maxSteps   主循环最大步数（防止死循环）
   * @param {(evt:object)=>void} opts.onEvent  流式事件回调
   */
  constructor(name, llm, opts = {}) {
    this.name = name;
    this.llm = llm instanceof LLM ? llm : new LLM(llm);
    this.toolRegistry = opts.toolRegistry;
    this.maxSteps = opts.maxSteps ?? 8;
    this.onEvent = opts.onEvent || (() => {});
    this.systemPrompt = opts.systemPrompt || `你是 ${name} 助手。`;

    this.tokenCounter =
      opts.tokenCounter ||
      new TokenCounter({ modelMaxTokens: opts.modelMaxTokens ?? 32000 });
    this.history = new HistoryManager({ tokenCounter: this.tokenCounter, maxTokens: 12000 });
    this.contextBuilder = opts.contextBuilder || new ContextBuilder();
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: opts.failureThreshold ?? 3,
      resetTimeoutMs: opts.resetTimeoutMs ?? 30000,
    });
    this.trace = new TraceLogger({ agent: name, console: !!opts.traceToConsole });

    this.sessionState = opts.sessionState || {};
    this._abort = null;
  }

  /* --------- 子类可覆盖 --------- */

  buildSystemPrompt() {
    return this.systemPrompt;
  }

  /** 主循环每步开始前的钩子，返回 false 可提前终止 */
  onStep() {
    return true;
  }

  onFinish(finalText) {
    return finalText;
  }

  /* --------- 核心 --------- */

  /**
   * 运行一次完整任务
   * @param {string} task
   * @param {object} [runOpts]
   * @param {Array}  [runOpts.chunks]  检索到的知识片段
   * @returns {Promise<{text:string, steps:Array, traceId:string}>}
   */
  async run(task, runOpts = {}) {
    this._abort = new AbortController();
    this.history.addUser(task);
    this.history.compress();

    const steps = [];
    const traceId = this.trace.start(task);

    this.onEvent({ type: 'start', agent: this.name, task, traceId });

    for (let step = 0; step < this.maxSteps; step++) {
      if (!this.onStep(step)) {
        this.onEvent({ type: 'aborted', agent: this.name, step });
        break;
      }

      // 1) 熔断检查
      const gate = this.circuitBreaker.check();
      if (!gate.allowed) {
        this.onEvent({ type: 'circuit_open', agent: this.name, reason: gate.reason });
        this.trace.warn(traceId, '熔断器打开', { reason: gate.reason });
        break;
      }

      const systemPrompt = this.buildSystemPrompt(runOpts);
      this.history.messages = this.history.messages.filter((m) => m.role !== 'system');
      this.history.messages.unshift({ role: 'system', content: systemPrompt });

      const toolNames = this.toolRegistry ? this.toolRegistry.list() : [];
      const tools = this.toolRegistry ? this.toolRegistry.getSpecs() : [];

      let out;
      try {
        this.onEvent({ type: 'thinking', agent: this.name, step });
        out = await this.llm.chat({
          messages: this.history.toArray(),
          tools,
          signal: this._abort.signal,
        });
        this.circuitBreaker.onSuccess();
      } catch (err) {
        this.circuitBreaker.onFailure(err);
        this.trace.error(traceId, '模型调用失败', { error: err.message });
        this.onEvent({ type: 'error', agent: this.name, step, message: err.message });
        // 熔断或硬错误：回退到离线能力，保证界面永远有可用输出
        const fallback = this.onModelError(err, task, runOpts);
        if (fallback) {
          this.onEvent({ type: 'message', agent: this.name, content: fallback, offline: true });
          return { text: fallback, steps, traceId };
        }
        throw err;
      }

      if (out.reasoning) {
        this.onEvent({ type: 'reasoning', agent: this.name, step, content: out.reasoning });
      }

      // 2) 无工具调用 → 本轮结束
      if (!out.toolCalls.length) {
        if (out.content) {
          this.history.addAssistant(out.content);
          this.onEvent({ type: 'message', agent: this.name, step, content: out.content });
          this.trace.ok(traceId, '完成', { step });
          return { text: this.onFinish(out.content), steps, traceId };
        }
        // 空回复：补一次引导，避免界面卡在"什么都没发生"
        this.history.addAssistant('（无内容）');
        this.onEvent({
          type: 'message',
          agent: this.name,
          step,
          content: '我没有得到有效回复，请换个说法或点上面的「示例问题」试试。',
        });
        return { text: '', steps, traceId };
      }

      // 3) 执行工具
      this.history.addAssistant(out.content, out.toolCalls);
      const stepRecord = { step, thought: out.content, toolCalls: [], results: [] };

      for (const call of out.toolCalls) {
        const rec = await this.executeTool(call);
        stepRecord.toolCalls.push(call);
        stepRecord.results.push(rec);
        this.history.addToolResult(call.id, call.name, rec.response);
      }
      steps.push(stepRecord);
      this.trace.tool(traceId, stepRecord);
    }

    const tail =
      steps.length >= this.maxSteps
        ? '本次推理步骤已达上限。可以点击「继续深入」或把问题拆小一点再问。'
        : '';
    if (tail) this.onEvent({ type: 'message', agent: this.name, content: tail });

    const last = [...steps].reverse().find((s) => s.results.some((r) => r.response.success));
    const lastText = last ? last.results[last.results.length - 1].response.content : '';
    this.trace.end(traceId);
    return { text: this.onFinish(lastText), steps, traceId, truncated: steps.length >= this.maxSteps };
  }

  /** 执行单个工具（带埋点与异常兜底） */
  async executeTool(call) {
    const started = Date.now();
    this.onEvent({ type: 'tool_start', agent: this.name, name: call.name, args: call.arguments });

    let response;
    try {
      const tool = this.toolRegistry && this.toolRegistry.get(call.name);
      if (!tool) {
        response = ToolResponse.fail(
          `不存在名为 ${call.name} 的工具。可用工具：${this.toolRegistry.list().join(', ')}`
        );
      } else {
        const raw = await tool.execute(call.arguments || {});
        response =
          raw instanceof ToolResponse
            ? raw
            : ToolResponse.ok(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
      }
    } catch (err) {
      response = ToolResponse.fail(`${call.name} 执行出错：${err.message}`);
    }

    const cost = Date.now() - started;
    this.onEvent({
      type: 'tool_end',
      agent: this.name,
      name: call.name,
      success: response.success,
      ms: cost,
      meta: response.meta,
    });
    return { call, response, ms: cost };
  }

  /** 模型不可用时的降级出口（子类覆盖，离线模式用） */
  onModelError(err) {
    this.onEvent({
      type: 'notice',
      message: `模型服务暂时不可用：${err.message}。已切换到「离线知识模式」，结果仍来自内置知识库。`,
    });
    return null;
  }

  abort() {
    if (this._abort) this._abort.abort();
  }
}

module.exports = { Agent };
