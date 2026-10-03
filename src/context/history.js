/**
 * 会话历史管理器
 * 移植自 HelloAgents 框架 context/history.py
 *
 * 负责：追加消息、按 token 预算裁剪、保留首轮系统提示与末轮对话。
 */

const { ToolResponse } = require('../tools/registry');

class HistoryManager {
  /**
   * @param {object} opts
   * @param {TokenCounter} opts.tokenCounter
   * @param {number} opts.maxTokens  历史区 token 预算
   */
  constructor(opts = {}) {
    this.tokenCounter = opts.tokenCounter;
    this.maxTokens = opts.maxTokens ?? 12000;
    this.messages = [];
  }

  addSystem(content) {
    // 系统提示始终置顶且唯一，重复调用时覆盖
    this.messages = this.messages.filter((m) => m.role !== 'system');
    this.messages.unshift({ role: 'system', content });
  }

  addUser(content) {
    this.messages.push({ role: 'user', content });
  }

  addAssistant(content, toolCalls) {
    const msg = { role: 'assistant', content: content || '' };
    if (toolCalls && toolCalls.length) msg.toolCalls = toolCalls;
    this.messages.push(msg);
  }

  addToolResult(toolCallId, name, response) {
    this.messages.push({
      role: 'tool',
      toolCallId,
      name,
      content: response instanceof ToolResponse ? response.content : String(response),
    });
  }

  /** 整轮对话开始时清空（保留系统提示） */
  clear() {
    this.messages = this.messages.filter((m) => m.role === 'system');
  }

  get size() {
    return this.messages.length;
  }

  get totalTokens() {
    return this.tokenCounter ? this.tokenCounter.countMessages(this.messages) : 0;
  }

  /** 按预算裁剪：保留系统提示 + 尽量新的对话 */
  compress() {
    if (!this.tokenCounter || this.totalTokens <= this.maxTokens) return this.messages;

    const system = this.messages.filter((m) => m.role === 'system');
    const rest = this.messages.filter((m) => m.role !== 'system');

    // 成对裁剪：避免留下孤立的 tool 结果
    while (
      rest.length > 2 &&
      this.tokenCounter.countMessages([...system, ...rest]) > this.maxTokens
    ) {
      // 找到第二个 user 消息之后的位置，保留完整的最后一轮
      let cut = 0;
      let userCount = 0;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].role === 'user') {
          userCount += 1;
          if (userCount === 2) {
            cut = i;
            break;
          }
        }
      }
      rest.splice(0, cut || 1);
    }
    this.messages = [...system, ...rest];
    return this.messages;
  }

  /** 导出会话快照（供持久化） */
  snapshot() {
    return this.messages.map((m) => ({ ...m }));
  }

  restore(msgs = []) {
    this.messages = msgs.map((m) => ({ ...m }));
  }

  toArray() {
    return this.messages.map((m) => ({ ...m }));
  }
}

module.exports = { HistoryManager };
