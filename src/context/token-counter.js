/**
 * Token 计数器
 * 移植自 HelloAgents 框架 context/token_counter.py
 *
 * 采用启发式估算（不依赖任何 tokenizer 库，保证零依赖）。
 * 对中英文混排分别加权，中文按字计、英文按词计。
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

function countTextTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  for (let i = 0; i < s.length; i++) if (CJK.test(s[i])) cjk++;
  const other = s.length - cjk;
  // 英文约 4 字符 ≈ 1 token；中文约 1 字 ≈ 0.6 token（偏保守估计）
  return Math.ceil(cjk * 0.6 + other / 4);
}

class TokenCounter {
  /**
   * @param {object} opts
   * @param {number} opts.modelMaxTokens  模型上下文窗口
   * @param {number} opts.reserveTokens    为模型输出预留
   */
  constructor(opts = {}) {
    this.modelMaxTokens = opts.modelMaxTokens ?? 32000;
    this.reserveTokens = opts.reserveTokens ?? 4096;
    this.perMessageOverhead = opts.perMessageOverhead ?? 4;
  }

  get budget() {
    return Math.max(1024, this.modelMaxTokens - this.reserveTokens);
  }

  countText(text) {
    return countTextTokens(text);
  }

  countMessages(messages = []) {
    let total = 0;
    for (const m of messages) {
      total += this.perMessageOverhead;
      total += this.countText(m.content);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          total += this.countText(tc.name) + this.countText(JSON.stringify(tc.arguments || {}));
        }
      }
    }
    return total;
  }

  countTools(tools = []) {
    let total = 0;
    for (const t of tools) {
      total += this.countText(t.name) + this.countText(t.description);
      total += this.countText(JSON.stringify(t.parameters || {}));
    }
    return total;
  }

  /** 当前配置下最多能放多少条消息 */
  maxMessages(messages = [], tools = []) {
    const used = this.countMessages(messages) + this.countTools(tools);
    const room = this.budget - used;
    if (room <= 0) return 0;
    const avg = messages.length
      ? Math.max(1, this.countMessages(messages) / messages.length)
      : 100;
    return Math.max(1, Math.floor(room / avg));
  }
}

module.exports = { TokenCounter, countTextTokens };
