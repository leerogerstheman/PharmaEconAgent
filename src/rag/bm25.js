/**
 * BM25 检索 + 中文无分词切分
 * ---------------------------------------------------------------
 * 不引入任何分词库（如 jieba），保证零依赖、离线可用。
 * 中文采用「一元 + 二元」组合切分，这是中文 IR 在无词典场景下的稳健做法：
 *   "药物经济学" → 药 / 物 / 经 / 济 / 学 / 药物 / 物经 / 经济 / 济学
 * 二元组显著提升专有名词与专业术语的召回精度。
 */

/* ============ 切分 ============ */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '等', '这', '那', '一个', '什么',
  '怎么', '如何', '为什么', '请问', '一下', '可以', '需要', '我们', '你们', '他们',
  'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'and', 'or', 'for', 'on', 'with',
  'what', 'how', 'why', 'do', 'does', 'i', 'you', 'it', 'be', 'as', 'at', 'by',
]);

/** 文本 → token 数组 */
function tokenize(text) {
  if (!text) return [];
  const s = String(text).toLowerCase();
  const tokens = [];

  // 拉丁词与数字
  const latin = s.match(/[a-z][a-z0-9_+-]*|\d+(?:\.\d+)?/g) || [];
  for (const w of latin) if (!STOP.has(w) && w.length > 1) tokens.push(w);

  // 中文：连续片段内做一元 + 二元切分
  const cjkRuns = s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      const uni = run[i];
      if (!STOP.has(uni)) tokens.push(uni);
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/* ============ BM25 ============ */

class BM25 {
  /**
   * @param {Array} docs 文档数组（元素需含 text 字段）
   * @param {object} opts
   *   k1 词频饱和参数，默认 1.5
   *   b  长度归一化参数，默认 0.75
   */
  constructor(docs, opts = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
    this.docs = docs;
    this.N = docs.length;
    this.docTokens = docs.map((d) => tokenize(d.text));
    this.docLen = this.docTokens.map((t) => t.length);
    this.avgLen = this.docLen.reduce((a, b) => a + b, 0) / (this.N || 1);

    // 倒排索引与文档频率
    this.df = new Map();
    this.tf = this.docTokens.map((tokens) => {
      const map = new Map();
      for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
      for (const t of map.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      return map;
    });
  }

  idf(term) {
    const n = this.df.get(term) || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  /**
   * @param {string} query
   * @param {number} topK
   * @returns {Array<{index, score}>}
   */
  search(query, topK = 8) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];

    // 查询词去重，权重按出现次数
    const qWeight = new Map();
    for (const t of qTokens) qWeight.set(t, (qWeight.get(t) || 0) + 1);

    const scores = new Array(this.N).fill(0);
    for (const [term, qw] of qWeight) {
      const idf = this.idf(term);
      if (idf <= 0) continue;
      for (let i = 0; i < this.N; i++) {
        const f = this.tf[i].get(term);
        if (!f) continue;
        const norm = 1 - this.b + this.b * (this.docLen[i] / this.avgLen);
        scores[i] += idf * ((f * (this.k1 + 1)) / (f + this.k1 * norm)) * qw;
      }
    }

    return scores
      .map((score, index) => ({ index, score }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

/**
 * 问句净化：剥掉与主题无关的"问句套话"
 * 学生提问时习惯说「QALY 是什么意思？能用一个例子讲讲吗？」，
 * 其中"是什么意思/能用一个例子/讲讲"等词会生成大量无意义中文二元组，
 * 严重污染 BM25 排序（实测会把无关文档排到第一）。
 * 剥离后只保留真正的检索意图词。
 */
const BOILERPLATE = [
  /请问|麻烦|谢谢/g,
  /能不能|可否|可以吗|行不行/g,
  /什么意思|是什么|啥意思|是啥|定义是|的定义/g,
  /能用.{0,4}例子|举个.{0,4}例子|举个.{0,2}例|举.{0,2}例子|比如|例如/g,
  /讲讲|讲一讲|讲一下|说说|讲讲呗|解释.{0,3}下|解释|介绍一下|介绍下|介绍/g,
  /我想知道|我想了解|想知道|了解一下|了解下|了解/g,
  /怎么|怎样|如何|咋|怎么办/g,
  /为什么|为啥|为何/g,
  /请|帮我|帮忙|给|替我/g,
  /一下|一些|点|呗|吗|呢|啊|呀|哦/g,
  /[?？!！。.,，、~～]/g,
  /\s+/g,
];

/** 清洗查询串；结果为空时回退为原文（避免过度清洗导致零命中） */
function normalizeQuery(text) {
  let q = String(text || '');
  for (const re of BOILERPLATE) q = q.replace(re, ' ');
  q = q.trim();
  return q.length >= 2 ? q : String(text || '').trim();
}

module.exports = { BM25, tokenize, normalizeQuery };
