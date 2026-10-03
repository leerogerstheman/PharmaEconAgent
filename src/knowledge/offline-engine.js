/**
 * 离线知识引擎（零配置可用）
 * ---------------------------------------------------------------
 * 当用户没有配置任何 API Key 时，Agent 仍必须给出**有依据**的回答。
 * 本模块用「意图识别 + 检索 + 结构化组装」生成答案，
 * 并明确标注引用来源，绝不凭空生成数字。
 *
 * 目标用户是药学/经济学学生，他们不该被"没有 API Key"这件事挡住。
 */

const INTENTS = [
  {
    id: 'term',
    test: /是什么|含义|定义|什么意思|缩写|全称|\b[a-z]{3,}\b/i,
    weight: 1,
  },
  { id: 'formula', test: /怎么算|如何计算|计算|公式|等于多少|多少\/|求出|算一下|是多少/, weight: 2 },
  { id: 'howto', test: /怎么做|如何做|步骤|流程|方法|怎样|怎么进行|需要注意|注意事项/, weight: 2 },
  { id: 'compare', test: /区别|不同|差异|比较|哪个好|优于|相比|对比|vs\b/i, weight: 2 },
  { id: 'policy', test: /指南|规范|要求|标准|CHEERS|NICE|WHO|医保|指南里|规定/, weight: 2 },
  { id: 'formula_what', test: /ICER|QALY|INMB|NMB|PSA|CEAC|DSA|OWSA|PSS|BIA|EVPI|EVSI|BCR|ROI/i, weight: 1 },
];

/**
 * 意图 → 主题先验
 * 纯统计检索在"有什么区别"这类问题上容易被高频词带偏
 * （"成本"把答案带到成本分类页，而不是分析类型对比页）。
 * 用一个显式的小先验纠正，比调 BM25 参数更可控也更容易解释。
 */
const TOPIC_PRIOR = {
  compare: { types: 0.55, icer: 0.15, threshold: 0.1 },
  formula: { icer: 0.3, effect: 0.25, sa: 0.15, discount: 0.12, bia: 0.1 },
  policy: { china: 0.4, intl: 0.3, reporting: 0.25 },
  howto: { model: 0.2, china: 0.15, types: 0.15 },
  term: { effect: 0.1, icer: 0.1 },
};

class OfflineEngine {
  constructor(kb) {
    this.kb = kb;
  }

  /** 意图识别：按权重累加，取最高分 */
  detectIntent(query) {
    const q = String(query || '');
    let best = { id: 'general', score: 0 };
    for (const it of INTENTS) {
      if (it.test.test(q)) {
        const score = it.weight;
        if (score > best.score) best = { id: it.id, score };
      }
    }
    return best.id;
  }

  /**
   * 生成回答
   * @param {string} query
   * @param {object} opts
   * @returns {{text, chunks, intent, suggestions, actions}}
   */
  answer(query, opts = {}) {
    const kb = this.kb;
    const q = String(query || '').trim();
    if (!q) {
      return {
        text: '请直接输入你的问题，比如「QALY 是什么意思」「ICER 怎么算」「中国指南推荐多少折现率」。',
        chunks: [], intent: 'general', suggestions: this.defaultSuggestions(), actions: [],
      };
    }

    const intent = this.detectIntent(q);
    const topK = intent === 'term' ? 4 : 5;
    let chunks = opts.chunks && opts.chunks.length ? opts.chunks : this._retrieve(q, intent, topK);

    // 术语优先：先从问题中抽出术语，再叠加普通检索结果
    const terms = kb.lookupTerm(q).length ? kb.lookupTerm(q) : kb.matchTerms(q);
    if (terms.length) {
      chunks = this._mergeTermFirst(terms, chunks);
    }

    if (!chunks.length) {
      return {
        text:
          `知识库里暂时没有直接对应「${q}」的条目。\n\n` +
          `你可以试试：\n` +
          `- 换用更常见的说法（例如把缩写展开成全称）\n` +
          `- 点击下方的示例问题\n` +
          `- 在「设置」中填入 API Key，开启 AI 深度问答（免费/低价服务均可）\n\n` +
          `知识库当前覆盖：${kb.topics.map((t) => t.name).join('、')}。`,
        chunks: [], intent, suggestions: this.defaultSuggestions(), actions: [],
      };
    }

    const text = this._compose(q, intent, chunks, terms);
    return {
      text,
      chunks: chunks.map((c) => ({ id: c.id, title: c.title, topic: c.topic, score: c.score })),
      intent,
      terms,
      suggestions: this._suggestions(intent, chunks),
      actions: this._actions(intent, chunks),
    };
  }

  /* ---------------- 内部 ---------------- */

  /** 带意图先验的检索 + 相关度地板 */
  _retrieve(query, intent, topK) {
    const prior = TOPIC_PRIOR[intent] || {};
    const hits = this.kb.search(query, { topK: Math.max(topK * 3, 12) });
    const scored = hits.map((h) => ({
      ...h,
      score: Math.min(1.5, h.score + (prior[h.topic] || 0)),
    }));
    scored.sort((a, b) => b.score - a.score);
    // 地板：明显不相关的宁可不展示，也不要倾倒无关文档
    const best = scored.length ? scored[0].score : 0;
    return scored.filter((h) => h.score >= Math.max(0.22, best * 0.28)).slice(0, topK);
  }

  _mergeTermFirst(terms, chunks) {
    const out = [];
    const seen = new Set();
    // 术语表命中视为权威解释，权重最高
    for (const t of terms) {
      const k = `term:${t.term}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        id: k,
        title: `${t.term}${t.en ? ` (${t.en})` : ''}`,
        topic: 'glossary',
        topicName: '术语',
        type: 'glossary',
        score: 0.99,
        content: this._formatTerm(t),
        source: t.source || '知识库术语表',
        url: t.url || '',
      });
    }
    for (const c of chunks) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }

  _formatTerm(t) {
    const lines = [`**${t.term}**${t.en ? ` — ${t.en}` : ''}${t.abbr ? `（${t.abbr}）` : ''}`, '', t.definition];
    if (t.formula) lines.push('', `**公式**：\`${t.formula}\``);
    if (t.notes) lines.push('', `**注意**：${t.notes}`);
    if (t.source) lines.push('', `**出处**：${t.source}`);
    return lines.join('\n');
  }

  _compose(query, intent, chunks, terms) {
    const parts = [];

    // 1) 先给一句话直答（离线模式下由最相关条目摘要充当）
    if (terms.length) {
      const t = terms[0];
      parts.push(`**${t.term}**${t.en ? `（${t.en}${t.abbr ? `，${t.abbr}` : ''}）` : ''}：${firstSentence(t.definition)}`);
      parts.push('');
    } else {
      parts.push(`关于「${query}」，知识库中有 ${chunks.length} 条相关内容，下面按重要性整理给你。`);
      parts.push('');
    }

    // 2) 主体内容
    // 术语类问题只给最相关的少量支撑材料 —— 对初学者来说，
    // 一次甩四篇长文不是"详实"而是"劝退"。
    // 并且补充材料必须在标题/别名/标签里真正出现该术语，否则宁可不展示。
    const main = chunks.filter((c) => c.id.indexOf('term:') !== 0);
    let pool = main.length ? main : chunks;
    if (intent === 'term' && terms.length) {
      const keys = terms
        .flatMap((t) => [t.term, t.abbr, ...(t.synonyms || [])])
        .map((s) => String(s || '').toLowerCase())
        .filter((s) => s.length > 1);
      const relevant = pool.filter((c) => {
        const hay = [c.title, ...(c.aliases || []), ...(c.tags || [])].join(' ').toLowerCase();
        return keys.some((k) => hay.includes(k));
      });
      if (relevant.length) pool = relevant;
    }
    const limit = intent === 'term' ? 2 : 4;
    const shown = pool.slice(0, limit);
    shown.forEach((c, i) => {
      parts.push(`### ${i + 1}. ${c.title}`);
      if (c.content) parts.push(c.content);
      const src = [];
      if (c.source) src.push(c.source);
      if (c.year) src.push(`${c.year}`);
      if (c.url) src.push(c.url);
      if (src.length) parts.push(`> 📎 来源：${src.join(' · ')}`);
      parts.push('');
    });

    // 3) 意图化的补充说明
    const tip = this._tip(intent, chunks);
    if (tip) {
      parts.push('### 💡 ' + tip.title);
      parts.push(tip.body);
      parts.push('');
    }

    // 4) 结尾引导
    parts.push('---');
    parts.push(
      intent === 'formula'
        ? '**接下来可以做什么**：点击下方「计算器」直接代入你的数据算出结果，比手算更不容易出错。'
        : '**接下来可以做什么**：点击下方的推荐问题继续追问，或到「学习路径」按顺序系统学习。'
    );

    return parts.join('\n');
  }

  _tip(intent, chunks) {
    const byTopic = (id) => chunks.some((c) => c.topic === id);
    switch (intent) {
      case 'formula':
        return {
          title: '别手算，用计算器',
          body: '药物经济学的数值计算容错率很低（增量符号、量纲、折现都容易错）。本软件内置的计算器与智能体调用的是同一套函数，结果可直接用于作业核对。',
        };
      case 'howto':
        return {
          title: '标准流程建议',
          body:
            '药物经济学评价的通用顺序是：明确决策问题与研究视角 → 确定比较方案与目标人群 → 收集成本与效果数据 → 建立模型 → 基础成本效果分析 → 增量成本效果比 → 不确定性分析 → 敏感性分析 → 报告与结论。\n' +
            '每一步都要写清楚"数据来源"和"假设"，这是审稿人最先看的地方。',
        };
      case 'compare':
        return {
          title: '做对比时的常见错误',
          body:
            '把"更便宜的方案"直接当作"更好的方案"是最常见的错误。成本-效果分析中，便宜但效果差的方案可能是不划算的（应看比值而非绝对值）；只有在两个方案效果相同时才用成本最小化分析。',
        };
      case 'policy':
        return {
          title: '规范与惯例要分清',
          body:
            'CHEERS 2022、NICE 方法学指南属于**报告规范/正式方法学文件**，要求明确；"我国折现率一般取 3%~5%"属于**惯例**，各地实践可能不同。写论文时应引用你实际遵循的那一份文件，并注明版本与年份。',
        };
      case 'term':
        return { title: '术语记忆法', body: '药经术语大多可拆解：ICER = Incremental（增量的）+ Cost（成本）+ Effect（效果）+ Ratio（比值）。拆开读比死记有效。' };
      default:
        if (byTopic('china')) {
          return { title: '中国语境提醒', body: '涉及中国医保政策时，请以国家医保局最新发布的目录与谈判结果为准，这类文件每年更新。' };
        }
        return null;
    }
  }

  _suggestions(intent, chunks) {
    const out = [];
    const topicOf = (c) => c && c.topic;
    const seed = {
      cma: ['成本最小化分析什么时候用？', 'CMA 要求效果完全相同吗？'],
      cea: ['成本-效果分析用什么做效果指标？', 'CEA 和 CUA 的区别是什么？'],
      cua: ['QALY 是怎么算出来的？', '效用值从哪来？'],
      icer: ['ICER 多少算划算？', 'ICER 为负数怎么解读？'],
      threshold: ['NICE 的阈值是多少？', 'ICER 阈值为什么不统一？'],
      psa: ['PSA 怎么做？', 'CEAC 曲线怎么看？'],
      model: ['决策树和 Markov 模型怎么选？', 'Markov 模型的基本结构是什么？'],
      discount: ['折现率取多少合适？', '效果要不要折现？'],
      china: ['中国药物经济学评价指南的核心要求？', '医保谈判中经济学评价的作用？'],
      reporting: ['CHEERS 2022 包括哪些条目？', '写报告要报告哪些内容？'],
    };
    const t = topicOf(chunks[0]);
    if (seed[t]) out.push(...seed[t]);
    if (intent === 'term') out.push('成本效果分析的基本流程是什么？', '增量成本效果比 ICER 怎么算？');
    if (intent === 'formula') out.push('QALY 计算公式是什么？', '概率敏感性分析怎么做？');
    if (intent === 'policy') out.push('CHEERS 2022 报告规范包括什么？', 'NICE 怎么用经济学评价？');
    return [...new Set(out)].slice(0, 4);
  }

  _actions(intent, chunks) {
    const acts = [];
    const has = (t) => chunks.some((c) => c.topic === t);
    if (intent === 'formula' || has('icer') || has('qaly') || has('psa')) {
      acts.push({ id: 'open-calculator', label: '打开计算器', icon: 'calculate' });
    }
    if (has('china') || has('policy') || has('reporting')) {
      acts.push({ id: 'open-checklist', label: '查看报告规范清单', icon: 'checklist' });
    }
    if (has('model')) {
      acts.push({ id: 'open-wizard', label: '开始建模向导', icon: 'route' });
    }
    return acts;
  }

  defaultSuggestions() {
    return [
      '药物经济学是研究什么的？',
      '成本-效果分析和成本-效用分析有什么区别？',
      'QALY 是怎么计算的？',
      'ICER 怎么算，多少算划算？',
      '概率敏感性分析怎么做？',
      '中国药物经济学评价指南有哪些核心要求？',
    ];
  }
}

function firstSentence(s) {
  if (!s) return '';
  const m = String(s).split(/(?<=[。！？.!?])/);
  return (m[0] || s).trim();
}

module.exports = { OfflineEngine, INTENTS };
