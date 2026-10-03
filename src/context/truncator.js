/**
 * 观察结果截断器
 * 移植自 HelloAgents 框架 context/truncator.py
 *
 * RAG 检索结果可能很长，截断时必须保留头部（结论）和尾部（来源），
 * 中间用省略号压缩，并给出"已省略多少"让模型知道信息不完整。
 */

const DEFAULTS = {
  maxChars: 2500,
  headRatio: 0.65,
  keepSourceTail: true,
};

class ObservationTruncator {
  constructor(opts = {}) {
    this.maxChars = opts.maxChars ?? DEFAULTS.maxChars;
    this.headRatio = opts.headRatio ?? DEFAULTS.headRatio;
    this.keepSourceTail = opts.keepSourceTail ?? DEFAULTS.keepSourceTail;
  }

  /**
   * @param {string} text
   * @param {number} [maxChars]
   */
  truncate(text, maxChars = this.maxChars) {
    const s = String(text ?? '');
    if (s.length <= maxChars) return { text: s, truncated: false, originalLength: s.length };

    const headLen = Math.floor(maxChars * this.headRatio);
    let tailLen = this.keepSourceTail ? Math.floor(maxChars * (1 - this.headRatio)) : 0;
    const head = s.slice(0, headLen);
    const tail = tailLen > 0 ? s.slice(s.length - tailLen) : '';
    const omitted = s.length - headLen - tailLen;

    const marker = `\n\n…【中间内容已省略 ${omitted} 字】…\n\n`;
    let out = head + marker + tail;

    // marker 本身占长度，做一次收敛
    if (out.length > maxChars) {
      out = out.slice(0, maxChars);
    }
    return { text: out, truncated: true, originalLength: s.length, omitted };
  }

  /** 批量截断 */
  truncateAll(texts, maxChars) {
    return texts.map((t) => this.truncate(t, maxChars));
  }
}

module.exports = { ObservationTruncator };
