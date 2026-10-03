/**
 * 上下文构建器
 * 移植自 HelloAgents 框架 context/builder.py
 *
 * 把"系统提示 + 检索到的知识片段 + 对话历史 + 用户问题"组装成最终 prompt。
 * 药物经济学场景下，检索片段按「主题 / 来源 / 相关度」结构化注入，
 * 让模型更容易引用，也更容易向学生解释依据。
 */

const { ToolResponse } = require('../tools/registry');
const { ObservationTruncator } = require('./truncator');

class ContextBuilder {
  constructor(opts = {}) {
    this.truncator = opts.truncator || new ObservationTruncator();
    this.maxKnowledgeChars = opts.maxKnowledgeChars ?? 6000;
  }

  /**
   * 把检索结果渲染成可注入的文本块
   * @param {Array} chunks [{title, topic, content, source, url, score}]
   */
  formatKnowledge(chunks = []) {
    if (!chunks.length) return '';
    const parts = [];
    for (const c of chunks) {
      const t = this.truncator.truncate(c.content || '', 1400);
      const meta = [];
      if (c.topic) meta.push(`主题：${c.topic}`);
      if (c.source) meta.push(`来源：${c.source}`);
      if (c.url) meta.push(`链接：${c.url}`);
      parts.push(
        `【知识片段 ${parts.length + 1}】${c.title ? ` ${c.title}` : ''}\n` +
          `元信息：${meta.join(' | ') || '内部知识库'}\n` +
          `相关度：${(c.score ?? 0).toFixed(3)}\n` +
          `正文：\n${t.text}`
      );
    }
    let out = parts.join('\n\n---\n\n');
    if (out.length > this.maxKnowledgeChars) {
      out = this.truncator.truncate(out, this.maxKnowledgeChars).text;
    }
    return out;
  }

  /**
   * 组装最终 system prompt
   * @param {object} p
   * @param {string} p.basePrompt     领域基础提示
   * @param {Array}  p.chunks         检索片段
   * @param {object} p.sessionState   会话状态（当前评估对象、已收集参数等）
   */
  buildSystemPrompt({ basePrompt, chunks = [], sessionState = {} }) {
    const parts = [basePrompt];

    const stateLines = [];
    if (sessionState.comparison && sessionState.comparison.intervention) {
      stateLines.push(
        `- 正在评估：对照「${sessionState.comparison.comparator}」 vs 干预「${sessionState.comparison.intervention}」`
      );
    }
    if (sessionState.analysisType) {
      stateLines.push(`- 已选分析类型：${sessionState.analysisType}`);
    }
    if (sessionState.assumptions && Object.keys(sessionState.assumptions).length) {
      stateLines.push(
        `- 已确认的参数：\n${Object.entries(sessionState.assumptions)
          .map(([k, v]) => `    · ${k} = ${JSON.stringify(v)}`)
          .join('\n')}`
      );
    }
    if (sessionState.currency) stateLines.push(`- 货币单位：${sessionState.currency}`);
    if (stateLines.length) {
      parts.push(`## 当前任务上下文\n${stateLines.join('\n')}`);
    }

    const knowledge = this.formatKnowledge(chunks);
    if (knowledge) {
      parts.push(
        `## 检索到的药物经济学知识库内容\n以下内容来自本软件内置知识库（含教材、指南与文献摘录）。` +
          `回答时必须以这些内容为准，并在相关处用 [片段N] 标注依据。\n\n${knowledge}`
      );
    }

    return parts.join('\n\n');
  }

  /** 渲染工具执行结果，失败时给出可自我修正的提示 */
  static renderToolResult(name, response) {
    if (response instanceof ToolResponse) {
      if (response.success) return response.content;
      return `${response.content}\n（请根据上述错误修正参数后重新调用工具）`;
    }
    return String(response);
  }
}

module.exports = { ContextBuilder };
