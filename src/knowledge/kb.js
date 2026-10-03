/**
 * 知识库加载与检索
 * ---------------------------------------------------------------
 * - kb.js          : 加载 / 校验 / 查询知识库（单例）
 * - retriever.js   : 混合检索（BM25 + 字段加权 + 同义词扩展）
 * - offline-engine : 无 LLM 时的检索式问答（保证零配置可用）
 */

const fs = require('fs');
const path = require('path');
const { BM25, tokenize, normalizeQuery } = require('../rag/bm25');

/** 标题/别名命中的权重倍率 —— 专有名词应压过仅正文偶然命中的文档 */
const TITLE_WEIGHT = 3.2;
const TAG_WEIGHT = 1.6;

class KnowledgeBase {
  constructor() {
    this.loaded = false;
    this.meta = {};
    this.chunks = [];
    this.glossary = [];
    this.formulas = [];
    this.checklists = [];
    this.resources = [];
    this.topics = [];
    this._bm25 = null;
    this._index = null;
    this._alias = null;
  }

  /** 从构建产物 JSON 加载 */
  load(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    this.meta = raw.meta || {};
    this.chunks = raw.chunks || [];
    this.glossary = raw.glossary || [];
    this.formulas = raw.formulas || [];
    this.checklists = raw.checklists || [];
    this.resources = raw.resources || [];
    this.topics = raw.topics || [];
    this.learningPath = raw.learningPath || [];
    this.examples = raw.examples || [];
    this.loaded = true;
    this._reindex();
    return this;
  }

  _reindex() {
    // 三路索引：标题别名（高权）、标签（中权）、正文（基准权）
    this._bm25Body = new BM25(this.chunks.map((c) => ({ text: c.content || '' })));
    this._bm25Title = new BM25(
      this.chunks.map((c) => ({ text: [c.title, c.title, c.aliases].join(' \n ') }))
    );
    this._bm25Tag = new BM25(this.chunks.map((c) => ({ text: [c.tags, c.topicName].join(' ') })));

    // 别名 → chunk id，便于精确命中（如 "QALY" "ICER"）
    this._alias = new Map();
    this.chunks.forEach((c) => {
      const keys = [c.id, c.title, ...(c.aliases || []), ...(c.tags || [])];
      for (const k of keys) {
        if (!k) continue;
        const key = String(k).toLowerCase();
        if (!this._alias.has(key)) this._alias.set(key, c.id);
      }
    });
  }

  get(id) {
    return this.chunks.find((c) => c.id === id);
  }

  /** 按主题取全部条目 */
  byTopic(topicId) {
    return this.chunks.filter((c) => c.topic === topicId);
  }

  /** 术语表查询：支持中英文与缩写 */
  lookupTerm(term) {
    const t = String(term || '').trim().toLowerCase();
    if (!t) return [];
    return this.glossary.filter(
      (g) =>
        g.term.toLowerCase() === t ||
        (g.abbr || '').toLowerCase() === t ||
        (g.en || '').toLowerCase().includes(t) ||
        (g.synonyms || []).some((s) => String(s).toLowerCase().includes(t))
    );
  }

  /**
   * 从自然语言问题中抽取术语（长词优先，避免 "ICER" 被 "ICER Threshold" 抢先）
   * "QALY 是什么意思" → [QALY]
   */
  matchTerms(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const g of this.glossary) {
      const candidates = [g.term, g.abbr, ...(g.synonyms || [])].filter(Boolean);
      for (const c of candidates) {
        const s = String(c).toLowerCase();
        // 缩写要求边界匹配，避免 "icer" 命中 "nicer" 之类
        const isAbbrev = /^[a-z]{2,6}$/.test(s);
        if (isAbbrev) {
          const re = new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`, 'i');
          if (re.test(q)) hits.push({ g, len: s.length, exact: true });
        } else if (s.length >= 2 && q.includes(s)) {
          hits.push({ g, len: s.length, exact: false });
        }
        if (g.en && g.en.toLowerCase().includes(q) && q.length >= 4) {
          hits.push({ g, len: 99, exact: true });
        }
      }
    }
    // 去重 + 长词优先
    const best = new Map();
    for (const h of hits) {
      const cur = best.get(h.g.term);
      if (!cur || h.len > cur.len) best.set(h.g.term, h);
    }
    return [...best.values()].sort((a, b) => b.len - a.len).map((h) => h.g);
  }

  /**
   * 混合检索
   * @param {string} query
   * @param {object} opts
   *   topK, topic(限定主题), type(限定类型), level(限定难度)
   * @returns {Array} 带 score 的 chunk
   */
  search(query, opts = {}) {
    if (!this.loaded) return [];
    const { topK = 6, topic, type, level } = opts;

    // 0) 剥离问句套话，避免"是什么意思/举个例子"污染排序
    const cleanQuery = normalizeQuery(query);

    // 1) 精确别名命中，给一个显著的高基准分
    const exactBoost = new Map();
    for (const tok of new Set(tokenize(cleanQuery))) {
      const id = this._alias.get(tok);
      if (id) exactBoost.set(id, (exactBoost.get(id) || 0) + 12);
    }
    // 完整标题/别名包含
    const ql = cleanQuery.toLowerCase();
    this.chunks.forEach((c) => {
      const keys = [c.title, ...(c.aliases || [])].filter(Boolean);
      for (const k of keys) {
        const ks = String(k).toLowerCase();
        if (ks.length > 1 && ql.includes(ks)) {
          exactBoost.set(c.id, (exactBoost.get(c.id) || 0) + 8);
          break;
        }
      }
    });

    // 2) 三路 BM25 加权融合
    const merge = (idx, weight) => {
      const m = new Map();
      for (const { index, score } of idx.search(cleanQuery, this.chunks.length)) {
        m.set(index, (m.get(index) || 0) + score * weight);
      }
      return m;
    };
    const total = new Map();
    for (const [idx, w] of [[this._bm25Title, TITLE_WEIGHT], [this._bm25Tag, TAG_WEIGHT], [this._bm25Body, 1]]) {
      for (const [i, s] of merge(idx, w)) total.set(i, (total.get(i) || 0) + s);
    }

    let pool = [...total.entries()]
      .map(([index, score]) => ({ index, score }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    if (topic || type || level) {
      const filtered = pool.filter(({ index }) => {
        const c = this.chunks[index];
        if (topic && c.topic !== topic) return false;
        if (type && c.type !== type) return false;
        if (level && c.level !== level) return false;
        return true;
      });
      if (filtered.length >= Math.min(3, topK)) pool = filtered;
    }

    const maxScore = pool.length ? pool[0].score : 1;
    const seen = new Set();
    const out = [];

    for (const { index, score } of pool) {
      const c = this.chunks[index];
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const norm = score / (maxScore || 1);
      out.push({ ...c, score: norm + (exactBoost.get(c.id) || 0) / 20, rawScore: score });
    }

    for (const [id, boost] of exactBoost) {
      if (seen.has(id)) continue;
      const c = this.get(id);
      if (!c) continue;
      if (topic && c.topic !== topic) continue;
      if (type && c.type !== type) continue;
      out.push({ ...c, score: 0.5 + boost / 20, rawScore: boost });
    }

    return out.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  get stats() {
    return {
      loaded: this.loaded,
      chunks: this.chunks.length,
      glossary: this.glossary.length,
      formulas: this.formulas.length,
      checklists: this.checklists.length,
      resources: this.resources.length,
      topics: this.topics.length,
    };
  }
}

module.exports = { KnowledgeBase };
