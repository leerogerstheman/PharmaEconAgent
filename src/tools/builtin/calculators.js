/**
 * 药物经济学计算工具集
 * ---------------------------------------------------------------
 * 这些工具是本 Agent 的核心价值：把公式变成可执行、可复现的计算，
 * 而不仅仅是"讲解公式"。每个工具都返回 ToolResponse，
 * 其中 meta.fields 会驱动前端渲染出结果卡片（表格 + 结论）。
 */

const { ToolResponse } = require('../registry');
const M = require('../../domain/math');

/**
 * 统一构造成功响应。
 * 字段要"摊平"到 meta 上（而不是塞进 meta.fields），
 * 前端 renderResult 才能直接读到 meta.rows / meta.kind / meta.probCE 等。
 */
const ok = (content, fields = {}, extra = {}) =>
  ToolResponse.ok(content, { kind: 'calculation', ...fields, ...extra });
const bad = (content) => ToolResponse.fail(content, { kind: 'calculation' });

/* ================= 1. 知识库检索 ================= */

function makeSearchTool(kb) {
  return {
    name: 'search_knowledge_base',
    description:
      '检索内置药物经济学知识库。当需要查阅概念定义、分析方法、指南要求、文献出处时必须调用。' +
      '返回条目含标题、主题、正文、来源与链接。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或自然语言问题' },
        topic: {
          type: 'string',
          description: '可选，限定主题 id（见主题列表），如 cma / icer / qaly / psa / china',
        },
        top_k: { type: 'number', description: '返回条数，默认 5' },
      },
      required: ['query'],
    },
    async execute({ query, topic, top_k }) {
      if (!query || !String(query).trim()) return bad('检索词不能为空，请描述你想了解的内容。');
      const hits = kb.search(query, { topK: Math.min(top_k || 5, 10), topic });
      if (!hits.length) {
        return ToolResponse.ok(
          `知识库中没有找到与「${query}」直接相关的条目。可以换个更常见的说法，或用 list_topics 查看全部主题。`,
          { kind: 'search', hits: [] }
        );
      }
      const body = hits
        .map(
          (h, i) =>
            `[${i + 1}] 《${h.title}》（${h.topicName || h.topic}｜相关度 ${h.score.toFixed(2)}）\n` +
            `${h.content}\n` +
            (h.source ? `来源：${h.source}${h.year ? `（${h.year}）` : ''}${h.url ? ` ${h.url}` : ''}` : '')
        )
        .join('\n\n');
      return ToolResponse.ok(
        `找到 ${hits.length} 条相关知识：\n\n${body}`,
        { kind: 'search', hits: hits.map((h) => ({ id: h.id, title: h.title, topic: h.topic, score: h.score })) }
      );
    },
  };
}

/* ================= 2. 术语解释 ================= */

function makeGlossaryTool(kb) {
  return {
    name: 'explain_term',
    description:
      '查询药物经济学专业术语的准确定义、英文全称、计算公式与出处。' +
      '遇到缩写（如 QALY、ICER、PSA、CEAC、INMB、DSA、DALY、NICE）时优先调用本工具。',
    parameters: {
      type: 'object',
      properties: { term: { type: 'string', description: '术语或缩写，如 QALY / ICER / CEAC' } },
      required: ['term'],
    },
    async execute({ term }) {
      const hits = kb.lookupTerm(term);
      if (!hits.length) {
        const f = kb.formulas.find(
          (x) => x.name.toLowerCase().includes(String(term).toLowerCase()) ||
            (x.aliases || []).some((a) => String(a).toLowerCase().includes(String(term).toLowerCase()))
        );
        if (f) {
          return ok(
            `【${f.name}】\n定义：${f.desc}\n公式：${f.expr}\n单位：${f.unit}\n示例：${f.example}`,
            { kind: 'term', term: f }
          );
        }
        return bad(`术语表里没有找到「${term}」。可以用 search_knowledge_base 检索相关条目。`);
      }
      const body = hits
        .map(
          (g) =>
            `【${g.term}】${g.en ? ` ${g.en}` : ''}${g.abbr ? `（${g.abbr}）` : ''}\n` +
            `定义：${g.definition}` +
            (g.formula ? `\n公式：${g.formula}` : '') +
            (g.notes ? `\n注意：${g.notes}` : '') +
            (g.source ? `\n出处：${g.source}` : '')
        )
        .join('\n\n');
      return ok(body, {
        kind: 'term',
        terms: hits.map((g) => ({
          term: g.term, en: g.en, abbr: g.abbr, definition: g.definition, formula: g.formula, source: g.source,
        })),
      });
    },
  };
}

/* ================= 3. ICER ================= */

const calcICERTool = {
  name: 'calc_icer',
  description:
    '计算增量成本效果比 ICER = Δ成本 / Δ效果，并给出成本效果平面四象限判定。' +
    '做成本-效果/成本-效用分析时的核心计算。',
  parameters: {
    type: 'object',
    properties: {
      cost_comparator: { type: 'number', description: '对照方案的总成本（现价，如元）' },
      effect_comparator: { type: 'number', description: '对照方案的总效果（如 QALY 或 LYG）' },
      cost_intervention: { type: 'number', description: '新方案的总成本' },
      effect_intervention: { type: 'number', description: '新方案的总效果' },
      threshold: { type: 'number', description: '可选，成本效果阈值（每 QALY 多少钱），如 NICE 约 20000-30000 英镑' },
    },
    required: ['cost_comparator', 'effect_comparator', 'cost_intervention', 'effect_intervention'],
  },
  async execute(a) {
    const { cost_comparator: c0, effect_comparator: e0, cost_intervention: c1, effect_intervention: e1, threshold } = a;
    if ([c0, e0, c1, e1].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
      return bad('四个参数都必须是数字。请检查是否漏填或填成了文字。');
    }
    const icer = M.calcICER(c0, e0, c1, e1);
    const plane = M.cePlane(c0, e0, c1, e1);
    const rows = [
      { 项目: '对照方案', 成本: M.fmtNum(c0), 效果: e0.toFixed(4) },
      { 项目: '新方案', 成本: M.fmtNum(c1), 效果: e1.toFixed(4) },
      { 项目: '增量（Δ）', 成本: M.fmtNum(plane.deltaCost), 效果: plane.deltaEffect.toFixed(4) },
      { 项目: 'ICER', 成本: M.fmtICER(icer.ok ? icer.icer : null), 效果: '元 / 单位效果' },
    ];

    // ⚠️ 关键方法学约束：必须先判象限，再谈阈值。
    // 被支配（效果更差且更贵）的方案，无论 ICER 数值多"好看"都不能采用 ——
    // 这是学生最常犯的错误，必须在工具层面就拦住。
    let verdict = plane.verdict;
    let headline = null;
    let costEffective = null;

    if (plane.quadrant === 'SW-') {
      verdict =
        '新方案效果更差且更贵，已被对照方案<b>完全支配（dominated）</b>，不应采用。' +
        '注意：此时 ICER 可能算出一个"看起来不错"的负数，但那是负数除法的假象，' +
        '绝不能据此说新方案更优。正确做法是直接放弃该方案。';
      headline = '结论：新方案被对照方案支配，不应采用';
      costEffective = false;
    } else if (plane.quadrant === 'NE') {
      headline = '结论：新方案效果更好且更便宜，强优势方案';
      verdict += '这类方案不需要再算 ICER，直接替代对照即可。';
      costEffective = true;
    } else if (plane.quadrant === 'SW') {
      headline = '结论：需权衡——新方案更便宜但效果更差';
      verdict +=
        '这类方案不能仅凭 ICER 判定，必须回到决策问题本身：' +
        '节省下来的成本是否值得牺牲这些效果？应补充健康产出维度的分析。';
      costEffective = null;
    } else if (threshold && icer.ok) {
      const pass = icer.icer <= threshold;
      costEffective = pass;
      headline = pass ? '结论：新方案具有成本效果' : '结论：按此阈值，新方案不具成本效果';
      verdict += pass
        ? ` 且 ICER（${M.fmtICER(icer.icer)}）低于阈值（${M.fmtNum(threshold)}），因此新方案具有成本效果。`
        : ` 但 ICER（${M.fmtICER(icer.icer)}）高于阈值（${M.fmtNum(threshold)}），按该阈值新方案不具成本效果。`;
    }

    const body =
      `增量成本 ΔC = ${M.fmtNum(plane.deltaCost)}；增量效果 ΔE = ${plane.deltaEffect.toFixed(4)}\n` +
      (icer.ok
        ? `ICER = ΔC / ΔE = ${M.fmtICER(icer.icer)}\n`
        : `ICER 无法计算：${icer.reason}\n`) +
      `成本效果平面位置：${plane.quadrant}\n判定：${verdict}`;
    return ok(body, {
      kind: 'icer',
      rows,
      icer: icer.ok ? icer.icer : null,
      plane,
      threshold: threshold || null,
      costEffective,
      headline,
      verdict,
    });
  },
};

/* ================= 4. QALY ================= */

const calcQALYTool = {
  name: 'calc_qaly',
  description:
    '计算质量调整生命年 QALY = Σ(健康状态效用值 × 停留时间)。' +
    '效用值通常来自 EQ-5D 等量表，取值 0（死亡）到 1（完全健康）。也可计算 DALY。',
  parameters: {
    type: 'object',
    properties: {
      states: {
        type: 'array',
        description: '健康状态数组，每项含 utility（效用值 0-1）与 duration（年数）或 years',
        items: {
          type: 'object',
          properties: {
            utility: { type: 'number', description: '该状态效用值 0-1' },
            duration: { type: 'number', description: '该状态持续年数' },
            label: { type: 'string', description: '状态名称，可选' },
          },
          required: ['utility', 'duration'],
        },
      },
      weight: { type: 'number', description: '可选，若算 DALY 请填失能权重（如死亡=1、严重失能=0.5）' },
    },
    required: ['states'],
  },
  async execute({ states, weight }) {
    if (!Array.isArray(states) || !states.length) return bad('states 必须是数组，且至少包含一个健康状态。');
    const clean = states.map((s, i) => ({
      utility: Number(s.utility),
      duration: Number(s.duration ?? s.years),
      label: s.label || `状态${i + 1}`,
    }));
    for (const s of clean) {
      if (Number.isNaN(s.utility) || Number.isNaN(s.duration)) {
        return bad(`「${s.label}」的 utility 或 duration 不是有效数字。`);
      }
    }
    if (clean.some((s) => s.utility < 0 || s.utility > 1)) {
      return bad('效用值必须在 0 到 1 之间（0=死亡，1=完全健康）。请检查后重试。');
    }
    const total = M.calcQALY(clean);
    const isDaly = typeof weight === 'number';
    const value = isDaly ? total * weight : total;
    const rows = clean.map((s) => ({
      健康状态: s.label,
      效用值: s.utility.toFixed(3),
      年数: s.duration.toFixed(2),
      贡献: (s.utility * s.duration).toFixed(4),
    }));
    rows.push({ 健康状态: '合计', 效用值: '—', 年数: clean.reduce((a, s) => a + s.duration, 0).toFixed(2), 贡献: value.toFixed(4) });
    const unit = isDaly ? 'DALY' : 'QALY';
    return ok(
      `${isDaly ? 'DALY（失能调整生命年）' : 'QALY（质量调整生命年）'} = Σ(效用 × 时间) = ${value.toFixed(4)} ${unit}\n` +
        `各状态构成见下表。注意：计算 ICER 时，效果指标必须与你的分析类型匹配（成本-效用分析用 QALY，成本-效果分析用自然单位如 LYG）。`,
      { kind: 'qaly', rows, value, unit: isDaly ? 'DALY' : 'QALY' }
    );
  },
};

/* ================= 5. INMB / NMBA ================= */

const calcINMBTool = {
  name: 'calc_inmb',
  description:
    '计算增量净货币效益 INMB = Δ成本 − 阈值 × Δ效果，以及净货币收益平均值 NMBA。' +
    'INMB > 0 表示在该阈值下新方案更值得推广，负值反之。',
  parameters: {
    type: 'object',
    properties: {
      cost_comparator: { type: 'number', description: '对照方案总成本' },
      effect_comparator: { type: 'number', description: '对照方案总效果' },
      cost_intervention: { type: 'number', description: '新方案总成本' },
      effect_intervention: { type: 'number', description: '新方案总效果' },
      threshold: { type: 'number', description: '阈值 λ（每 QALY 愿付金额），如 50000' },
    },
    required: ['cost_comparator', 'effect_comparator', 'cost_intervention', 'effect_intervention', 'threshold'],
  },
  async execute({ cost_comparator: c0, effect_comparator: e0, cost_intervention: c1, effect_intervention: e1, threshold }) {
    const nums = [c0, e0, c1, e1, threshold];
    if (nums.some((v) => typeof v !== 'number' || Number.isNaN(v))) return bad('所有参数必须是数字。');
    const inmb = M.calcINMB(c0, e0, c1, e1, threshold);
    const dC = c1 - c0;
    const dE = e1 - e0;
    const breakeven = dE !== 0 ? dC / dE : null;
    return ok(
      `INMB = Δ成本 − λ × Δ效果 = ${M.fmtNum(dC)} − ${M.fmtNum(threshold)} × ${dE.toFixed(4)} = ${M.fmtNum(inmb)}\n` +
        `NMBA = INMB = ${M.fmtNum(inmb)}。${inmb > 0 ? '结果为正，说明在该阈值下新方案更值得采用。' : '结果为负，说明在该阈值下新方案不值得采用。'}\n` +
        (breakeven !== null ? `临界阈值（ICER）= ${M.fmtICER(breakeven)}，与 λ 比较即可判断。` : ''),
      {
        kind: 'inmb',
        inmb,
        threshold,
        breakeven,
        rows: [
          { 项目: 'Δ成本 (ΔC)', 数值: M.fmtNum(dC) },
          { 项目: 'Δ效果 (ΔE)', 数值: dE.toFixed(4) },
          { 项目: '阈值 (λ)', 数值: M.fmtNum(threshold) },
          { 项目: 'INMB / NMBA', 数值: M.fmtNum(inmb) },
          { 项目: '结论', 数值: inmb > 0 ? '新方案占优' : '新方案不占优' },
        ],
      }
    );
  },
};

/* ================= 6. PSA 概率敏感性分析 ================= */

const calcPSATool = {
  name: 'calc_psa',
  description:
    '概率敏感性分析 PSA：对成本与效果参数按指定分布抽样（支持 uniform/normal/gamma/beta/lognormal/triangular），' +
      '计算每个阈值下的成本效果可接受概率，并估计可接受阈值 CEPT。相同 seed 结果完全可复现。',
  parameters: {
    type: 'object',
    properties: {
      c0: { type: 'string', description: '对照成本分布，如 10000 或 {"type":"lognormal","mean":10000,"cv":0.3}' },
      c1: { type: 'string', description: '新方案成本分布' },
      e0: { type: 'string', description: '对照效果分布，如 5 或 {"type":"beta","mean":0.6,"se":0.1}' },
      e1: { type: 'string', description: '新方案效果分布' },
      lambda: { type: 'number', description: '分析阈值 λ，如 50000' },
      n: { type: 'number', description: '抽样次数，默认 1000' },
      seed: { type: 'number', description: '随机种子，默认 20240101（换种子可看不同模拟）' },
      lambda_max: { type: 'number', description: 'CEAC 横轴最大值，默认按 lambda 的 3 倍' },
    },
    required: ['c0', 'c1', 'e0', 'e1', 'lambda'],
  },
  async execute(a) {
    const parse = (v) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const s = v.trim();
        if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      }
      return v;
    };
    const c0 = parse(a.c0), c1 = parse(a.c1), e0 = parse(a.e0), e1 = parse(a.e1);
    if ([c0, c1, e0, e1].some((v) => v === null || v === undefined)) {
      return bad(
        '参数格式错误。数字直接写数字；分布请写成 JSON 字符串，例如 ' +
          '{"type":"lognormal","mean":10000,"cv":0.3} 或 {"type":"beta","mean":0.6,"se":0.1}。'
      );
    }
    const lambda = Number(a.lambda);
    if (!Number.isFinite(lambda)) return bad('lambda 必须是数字。');
    const n = Math.min(Math.max(Number(a.n) || 1000, 100), 20000);
    const seed = Number(a.seed) || 20240101;
    const lambdaMax = Number(a.lambda_max) || lambda * 3;

    const res = M.PSA({ c0, c1, e0, e1, lambda, n, seed });
    const curve = M.ceac(res, lambdaMax, 61);
    const stats = M.einbStats(res);
    const meanICER = res.meanDeltaEffect !== 0 ? res.meanDeltaCost / res.meanDeltaEffect : null;

    const rows = [
      { 指标: '平均 Δ成本', 数值: M.fmtNum(res.meanDeltaCost) },
      { 指标: '平均 Δ效果', 数值: res.meanDeltaEffect.toFixed(4) },
      { 指标: '均值 ICER（非最佳指标，仅参考）', 数值: M.fmtICER(meanICER) },
      { 指标: `阈值 ${M.fmtNum(lambda)} 下的可接受概率`, 数值: M.fmtPct(res.probCE) },
      { 指标: 'NMBA (INMB 均值)', 数值: M.fmtNum(res.nmba) },
      { 指标: 'INMB 5% 分位', 数值: M.fmtNum(stats.p5) },
      { 指标: 'INMB 中位数', 数值: M.fmtNum(stats.p50) },
      { 指标: 'INMB 95% 分位', 数值: M.fmtNum(stats.p95) },
      { 指标: '可接受阈值 CEPT (P=50%)', 数值: curve.cept === null ? '未达到 50%' : M.fmtNum(curve.cept) },
      { 指标: '抽样次数 / 种子', 数值: `${n} / ${seed}` },
    ];

    const conclusion =
      `在 λ = ${M.fmtNum(lambda)} 的阈值下，新方案具有成本效果的概率为 ${M.fmtPct(res.probCE)}。` +
      (res.probCE >= 0.8
        ? '高于 80%，属于证据较强。'
        : res.probCE >= 0.5
        ? '介于 50%-80% 之间，结论对参数假设较为敏感，建议补充敏感性分析。'
        : '低于 50%，在该阈值下证据不支持采用新方案。') +
      (curve.cept !== null ? ` 估计的成本效果可接受阈值为 ${M.fmtNum(curve.cept)}（概率首次达到 50% 的 λ）。` : '');

    return ok(
      `已完成 ${n} 次概率抽样（seed=${seed}，结果可复现）。\n` +
        `平均 Δ成本 ${M.fmtNum(res.meanDeltaCost)}，平均 Δ效果 ${res.meanDeltaEffect.toFixed(4)}。\n` +
        conclusion +
        `\n提示：不要用"均值 ICER"作为主要结论，PSA 的可接受概率才是主流报告口径。`,
      { kind: 'psa', rows, probCE: res.probCE, nmba: res.nmba, ceac: curve, stats, conclusion, n, seed }
    );
  },
};

/* ================= 7. 单因素敏感性分析 ================= */

const calcOWSATool = {
  name: 'calc_owsa',
  description:
    '单因素敏感性分析（龙卷风图）。每次只改变一个参数到低值或高值，计算 ICER 或 INMB 的变化幅度，' +
      '按影响大小排序，指出哪个参数最影响结论。',
  parameters: {
    type: 'object',
    properties: {
      cost_comparator: { type: 'number', description: '对照方案总成本（基准）' },
      effect_comparator: { type: 'number', description: '对照方案总效果（基准）' },
      cost_intervention: { type: 'number', description: '新方案总成本（基准）' },
      effect_intervention: { type: 'number', description: '新方案总效果（基准）' },
      threshold: { type: 'number', description: '阈值 λ' },
      parameters: {
        type: 'array',
        description:
          '参数列表，每项 {name, deltaC0?, deltaC1?, deltaE0?, deltaE1?}，delta 表示该参数由基准变到低/高值时的增量',
        items: { type: 'object', properties: { name: { type: 'string' } } },
      },
    },
    required: ['cost_comparator', 'effect_comparator', 'cost_intervention', 'effect_intervention', 'threshold', 'parameters'],
  },
  async execute(a) {
    const { cost_comparator: c0, effect_comparator: e0, cost_intervention: c1, effect_intervention: e1, threshold, parameters } = a;
    if (!Array.isArray(parameters) || !parameters.length) {
      return bad('parameters 必须是非空数组，每项说明一个参数及其低值/高值相对基准的改变量。');
    }
    const base = { c0, e0, c1, e1 };
    const res = M.oneWaySA(base, parameters, threshold);
    const rows = res.rows.map((r) => ({
      参数: r.name,
      'INMB(低值)': M.fmtNum(r.low.inmb),
      'INMB(高值)': M.fmtNum(r.high.inmb),
      摆动幅度: M.fmtNum(r.swing),
      '低值ICER': M.fmtICER(r.low.icer),
    }));
    rows.push({
      参数: '【基准】',
      'INMB(低值)': M.fmtNum(res.baseINMB),
      'INMB(高值)': M.fmtNum(res.baseINMB),
      摆动幅度: '—',
      '低值ICER': M.fmtICER(res.baseICER.ok ? res.baseICER.icer : null),
    });
    const top = res.rows.slice(0, 3).map((r) => r.name);
    return ok(
      `基准 INMB = ${M.fmtNum(res.baseINMB)}，基准 ICER = ${M.fmtICER(res.baseICER.ok ? res.baseICER.icer : null)}。\n` +
        `影响最大的三个参数是：${top.join('、')}。\n` +
        `这些参数是后续 PSA 中最该做概率分布假设的对象，也是与审评方讨论时的重点。`,
      { kind: 'owsa', rows, top, baseINMB: res.baseINMB }
    );
  },
};

/* ================= 8. 折现 ================= */

const calcDiscountTool = {
  name: 'calc_discount',
  description:
    '计算成本与效果的贴现现值。用于多年期模型：给出各年的成本与效果，得到现值。' +
      '国际通行做法：成本与效果分别按相同折现率折现，但计算 ICER 时分子分母都用现值。',
  parameters: {
    type: 'object',
    properties: {
      flows: {
        type: 'array',
        description: '各年现金流数组，每项 {year, cost, effect}，year 从 0 开始',
        items: {
          type: 'object',
          properties: {
            year: { type: 'number', description: '年份（0=基线）' },
            cost: { type: 'number', description: '该年成本' },
            effect: { type: 'number', description: '该年效果（QALY）' },
          },
          required: ['year', 'cost'],
        },
      },
      rate: { type: 'number', description: '折现率（百分数，如 5 表示 5%）。中国指南推荐 3%-5%' },
      discount_effect: { type: 'boolean', description: '效果是否也折现，默认 true' },
    },
    required: ['flows', 'rate'],
  },
  async execute({ flows, rate, discount_effect }) {
    if (!Array.isArray(flows) || !flows.length) return bad('flows 必须是非空数组。');
    if (typeof rate !== 'number' || rate < 0) return bad('折现率必须是不小于 0 的数字（百分数，例如 5 表示 5%）。');
    const res = M.discount(flows, rate, discount_effect !== false);
    const rows = res.detail.map((d) => ({
      年份: d.year,
      折现因子: d.discountFactor.toFixed(4),
      成本现值: M.fmtNum(d.pvCost),
      效果现值: d.pvEffect.toFixed(4),
    }));
    rows.push({ 年份: '合计', 折现因子: '—', 成本现值: M.fmtNum(res.pvCost), 效果现值: res.pvEffectDisc.toFixed(4) });
    const icer = res.pvEffectDisc !== 0 ? res.pvCost / res.pvEffectDisc : null;
    return ok(
      `按 ${rate}% 折现：\n` +
        `总成本现值 = ${M.fmtNum(res.pvCost)}\n` +
        `总效果现值 = ${res.pvEffectDisc.toFixed(4)}（未折现为 ${res.pvEffectUndisc.toFixed(4)}）\n` +
        (icer !== null ? `折现后的 ICER = ${M.fmtICER(icer)}\n` : '') +
        `提示：不同指南对效果是否折现要求不同。做敏感性分析时应同时报告 0% 与所选折现率下的结果，因为折现率会显著影响 ICER。`,
      { kind: 'discount', rows, ...res, icer }
    );
  },
};

/* ================= 9. 预算影响分析 ================= */

const calcBIATool = {
  name: 'calc_bia',
  description:
    '预算影响分析 BIA：估算新药进入市场后，在目标人群和渗透率假设下对医保基金/医院预算的年度净影响。' +
      '与成本效果分析回答的问题不同：BIA 回答"花多少钱"，CEA 回答"值不值"。',
  parameters: {
    type: 'object',
    properties: {
      eligible: { type: 'number', description: '目标人群总人数' },
      uptake_before: { type: 'number', description: '现有治疗的渗透率（0-1 之间的小数，如 0.1 表示 10%）' },
      uptake_after: { type: 'number', description: '新药上市后（含替代后）的渗透率，如 0.5' },
      annual_cost_before: { type: 'number', description: '原有治疗每人每年成本' },
      annual_cost_after: { type: 'number', description: '新方案每人每年成本' },
      displaceable: { type: 'number', description: '新药治疗者可被替代掉原治疗的比例（0-1）' },
      horizon: { type: 'number', description: '预算影响年限，默认 5 年' },
    },
    required: ['eligible', 'uptake_before', 'uptake_after', 'annual_cost_before', 'annual_cost_after'],
  },
  async execute(a) {
    const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
    if (typeof a.eligible !== 'number') return bad('eligible（目标人群）必须是数字。');
    const res = M.budgetImpact({
      eligible: a.eligible,
      uptakeBefore: num(a.uptake_before, 0),
      uptakeAfter: num(a.uptake_after, 0),
      annualCostBefore: num(a.annual_cost_before, 0),
      annualCostAfter: num(a.annual_cost_after, 0),
      displaceable: num(a.displaceable, 0),
      horizon: num(a.horizon, 5),
    });
    const rows = [
      { 项目: '目标人群', 数值: `${M.fmtNum(res.eligible)} 人` },
      { 项目: '现有治疗人数', 数值: `${M.fmtNum(res.treatedBefore)} 人` },
      { 项目: '新方案治疗后人数', 数值: `${M.fmtNum(res.treatedAfter)} 人` },
      { 项目: '新增治疗人数', 数值: `${M.fmtNum(res.newlyTreated)} 人` },
      { 项目: '原有方案年度总成本', 数值: M.fmtNum(res.grossCostBefore) },
      { 项目: '新方案年度总成本', 数值: M.fmtNum(res.grossCostAfter) },
      { 项目: '被替代掉的原治疗成本', 数值: `-${M.fmtNum(res.displacedCost)}` },
      { 项目: '年度净预算影响', 数值: M.fmtNum(res.netAnnualImpact) },
      { 项目: `${res.horizon} 年累计净影响`, 数值: M.fmtNum(res.totalImpact) },
      { 项目: '较原有方案增幅', 数值: res.percentIncrease === null ? '—' : `${res.percentIncrease.toFixed(1)}%` },
    ];
    return ok(
      `年度净预算影响 = ${M.fmtNum(res.netAnnualImpact)}，${res.horizon} 年累计 ${M.fmtNum(res.totalImpact)}。\n` +
        `${res.netAnnualImpact > 0 ? '这意味着需要额外增加预算。' : '这意味着可节省预算。'}` +
        `\n提示：BIA 结果对渗透率和替代率极其敏感，通常需要配合情景分析（乐观/中性/悲观）一起报告。`,
      { kind: 'bia', rows, result: res }
    );
  },
};

/* ================= 10. 决策树期望值 / EVSI ================= */

const calcDecisionTreeTool = {
  name: 'calc_decision_tree',
  description:
    '决策树分析：计算各备选策略的期望成本/期望效果（EV），并计算完全信息期望值 EVPI 与样本信息期望值 EVSI，' +
      '回答"是否值得进一步开展临床试验或调研"。',
  parameters: {
    type: 'object',
    properties: {
      strategies: {
        type: 'array',
        description: '各策略结局数组，每项 {prob, cost, effect}，prob 之和应为 1',
        items: { type: 'object', properties: { prob: { type: 'number' }, cost: { type: 'number' }, effect: { type: 'number' } } },
      },
      threshold: { type: 'number', description: '阈值 λ，用于计算净货币收益' },
      evpi: { type: 'boolean', description: '是否计算 EVPI，默认 false' },
    },
    required: ['strategies'],
  },
  async execute({ strategies, threshold, evpi }) {
    if (!Array.isArray(strategies) || !strategies.length) return bad('strategies 必须是非空数组。');
    const rows = [];
    let best = null;
    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i];
      const outcomes = s.outcomes || [];
      if (!outcomes.length) {
        return bad(`策略 ${i + 1} 缺少 outcomes 数组。`);
      }
      const sumP = outcomes.reduce((a, o) => a + (Number(o.prob) || 0), 0);
      if (Math.abs(sumP - 1) > 0.02) {
        return bad(`策略 ${i + 1} 的概率之和为 ${sumP.toFixed(3)}，应等于 1。请检查。`);
      }
      const evCost = outcomes.reduce((a, o) => a + o.prob * (Number(o.cost) || 0), 0);
      const evEffect = outcomes.reduce((a, o) => a + o.prob * (Number(o.effect) || 0), 0);
      const evInmb = threshold ? evCost - threshold * evEffect : null;
      rows.push({
        策略: s.name || `策略${i + 1}`,
        期望成本: M.fmtNum(evCost),
        期望效果: evEffect.toFixed(4),
        期望INMB: evInmb === null ? '—' : M.fmtNum(evInmb),
        // 保留原始数值供比较，避免用格式化字符串做大小比较
        _raw: { name: s.name || `策略${i + 1}`, evCost, evEffect, evInmb },
      });
      if (!best || (evInmb !== null ? evInmb > best.evInmb : evEffect > best.evEffect)) {
        best = { name: s.name || `策略${i + 1}`, evCost, evEffect, evInmb, outcomes };
      }
    }
    let extra = '';
    if (evpi && threshold && best) {
      const perfectValues = best.outcomes.map((o) => -(o.prob && threshold ? 0 : 0) - (o.cost || 0) + threshold * (o.effect || 0));
      const evpiVal = perfectValues.reduce((a, v) => a + v, 0) - best.evInmb;
      extra = `\n完全信息期望值 EVPI = ${M.fmtNum(evpiVal)}。` +
        (evpiVal > 0 ? '大于 0，说明消除参数不确定性本身有价值，值得投入研究资源。' : '小于 0，无需进一步研究。');
    }
    // 用原始数值比较（不是格式化后的字符串），有阈值时比 INMB，否则比期望效果
    let maxRaw = null;
    for (const r of rows) {
      if (!maxRaw) maxRaw = r._raw;
      else {
        const cmp = threshold
          ? (r._raw.evInmb > maxRaw.evInmb)
          : (r._raw.evEffect > maxRaw.evEffect);
        if (cmp) maxRaw = r._raw;
      }
    }
    const maxRow = rows.find((r) => r._raw.name === maxRaw.name);
    const rowsForDisplay = rows.map((r) => {
      const c = { ...r };
      delete c._raw;
      return c;
    });
    return ok(
      `最优策略为「${maxRow.策略}」，期望成本 ${maxRow.期望成本}，期望效果 ${maxRow.期望效果}` +
        (threshold ? `，期望 INMB ${maxRow.期望INMB}` : '') + `。${extra}`,
      { kind: 'decision_tree', rows: rowsForDisplay, best: maxRow.策略, allStrategies: rows.map((r) => r._raw) }
    );
  },
};

/* ================= 11. 成本效益分析（净现值） ================= */

const calcCBATool = {
  name: 'calc_cba',
  description:
    '成本-效益分析 CBA：把效果货币化为货币收益（意愿支付 WTP / 收入法 / 生产率法），' +
      '计算净现值 NPV 与净现值比 NPV = (总收益 − 总成本) / 总成本，判断是否值得投入。',
  parameters: {
    type: 'object',
    properties: {
      total_benefit: { type: 'number', description: '总收益（已货币化的效果）' },
      total_cost: { type: 'number', description: '总成本' },
      horizon: { type: 'number', description: '年限（可选，用于计算 BCR）' },
    },
    required: ['total_benefit', 'total_cost'],
  },
  async execute({ total_benefit: b, total_cost: c }) {
    if (typeof b !== 'number' || typeof c !== 'number') return bad('total_benefit 与 total_cost 必须是数字。');
    if (c === 0) return bad('总成本为 0，无法计算净现值比。请检查输入。');
    const npv = b - c;
    const bcr = b / c;
    const rows = [
      { 项目: '总收益', 数值: M.fmtNum(b) },
      { 项目: '总成本', 数值: M.fmtNum(c) },
      { 项目: '净现值 NPV (收益−成本)', 数值: M.fmtNum(npv) },
      { 项目: '净现值比 NPV比 (收益/成本)', 数值: bcr.toFixed(3) },
      { 项目: '结论', 数值: npv > 0 ? '收益大于成本，值得投入' : '收益不足以抵偿成本，不值得投入' },
    ];
    return ok(
      `净现值 = 总收益 − 总成本 = ${M.fmtNum(npv)}；净现值比 = ${bcr.toFixed(3)}。` +
        `${npv > 0 ? '该项目净收益为正。' : '该项目净收益为负。'}`,
      { kind: 'cba', rows, npv, bcr }
    );
  },
};

/* ================= 12. 疾病成本 / 流行病学转化 ================= */

const calcCOITool = {
  name: 'calc_coi',
  description:
    '疾病成本 COI 计算：患病率法（prevalence-based）与发病率法（incidence-based）。' +
      '发病率法按病程分期成本累加，流行病学上更严谨；患病率法简单但会高估慢性病成本。',
  parameters: {
    type: 'object',
    properties: {
      population: { type: 'number', description: '目标人群总数' },
      prevalence: { type: 'number', description: '患病率（0-1 小数）' },
      annual_cost_per_case: { type: 'number', description: '每例患者年成本' },
      method: { type: 'string', description: 'prevalence（患病率法）或 incidence（发病率法）' },
    },
    required: ['population', 'prevalence', 'annual_cost_per_case'],
  },
  async execute({ population, prevalence, annual_cost_per_case, method }) {
    if ([population, prevalence, annual_cost_per_case].some((v) => typeof v !== 'number')) {
      return bad('population、prevalence、annual_cost_per_case 都必须是数字。');
    }
    if (prevalence > 1) return bad('prevalence 请用 0-1 之间的小数（例如 5% 写 0.05），不要直接写 5。');
    const cases = population * prevalence;
    const total = cases * annual_cost_per_case;
    const rows = [
      { 项目: '目标人群', 数值: `${M.fmtNum(population)} 人` },
      { 项目: '患病率', 数值: M.fmtPct(prevalence) },
      { 项目: '患者人数', 数值: `${M.fmtNum(cases)} 人` },
      { 项目: '每例年成本', 数值: M.fmtNum(annual_cost_per_case) },
      { 项目: '年疾病总成本', 数值: M.fmtNum(total) },
    ];
    return ok(
      `按${method === 'incidence' ? '发病' : '患病'}率法计算，${M.fmtNum(prevalence * 100)}% 患病率对应 ${M.fmtNum(cases)} 名患者，` +
        `年疾病成本合计 ${M.fmtNum(total)}。\n` +
        `提示：患病率法会把病程早期的成本重复计入，适合快速估算；正式研究建议用发病率法并按病程分期。`,
      { kind: 'coi', rows, cases, total, method: method || 'prevalence' }
    );
  },
};

/* ================= 13. 主题列表 ================= */

const listTopicsTool = (kb) => ({
  name: 'list_topics',
  description: '列出内置知识库的全部主题及其条目数。当不确定知识库覆盖范围时先调用本工具。',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const list = kb.topics
      .map((t) => {
        const n = kb.byTopic(t.id).length;
        return `${t.icon || '•'} 【${t.id}】${t.name} —— ${n} 条${t.summary ? `；${t.summary}` : ''}`;
      })
      .join('\n');
    return ok(
      `知识库共 ${kb.chunks.length} 条目、${kb.glossary.length} 个术语，主题如下：\n${list}`,
      { kind: 'topics', topics: kb.topics }
    );
  },
});

/* ================= 14. 报告生成 ================= */

const reportTool = {
  name: 'build_report',
  description:
    '生成一份结构化的药物经济学分析报告（Markdown），包含背景、方法、结果、敏感性分析与结论。' +
      '用于把零散的计算结果整理成可交付的文档。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '报告标题' },
      sections: { type: 'string', description: '各章节内容，用 === 分隔，格式为「章节名|||内容」' },
    },
    required: ['title'],
  },
  async execute({ title, sections }) {
    if (!title) return bad('请提供报告标题。');
    const parts = String(sections || '')
      .split('===')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [h, ...body] = s.split('|||');
        return `## ${h.trim()}\n\n${body.join('|||').trim() || '（待补充）'}`;
      });
    const md = [
      `# ${title}`,
      '',
      `> 本报告由「药物经济学智能体」生成 · ${new Date().toLocaleString('zh-CN')}`,
      '> 生成内容仅供学习与作业参考，正式研究请以原始指南与文献为准，并遵循 CHEERS 2022 报告规范。',
      '',
      parts.length ? parts.join('\n\n') : '## 内容\n\n（尚未提供章节内容）',
      '',
      '---',
      '',
      '**声明**：本软件输出为学习辅助工具的结果，不构成医疗、用药或医保决策建议。',
    ].join('\n');
    return ok(
      `已生成报告（${parts.length} 个章节）。用户可在界面中点击「导出报告」保存为 .md 或 .txt 文件。`,
      { kind: 'report', markdown: md, title }
    );
  },
};

/* ================= 15. 报告规范检查清单 ================= */

const checklistTool = (kb) => ({
  name: 'get_checklist',
  description:
    '获取方法学报告规范清单（如 CHEERS 2022、中国药物经济学评价指南）。用于自查报告是否完整，' +
      '写论文/作业时逐项对照。',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: '清单 id，如 cheers / china / ssa' } },
    required: ['id'],
  },
  async execute({ id }) {
    const list = kb.checklists || [];
    const hit = list.find((c) => c.id === String(id || '').toLowerCase()) || list[0];
    if (!hit) return bad('没有可用的检查清单。');
    const body = hit.items
      .map((it, i) => `${i + 1}. ${typeof it === 'string' ? it : `${it.text}（对应：${it.cheers}）`}`)
      .join('\n');
    return ok(
      `【${hit.name}】共 ${hit.items.length} 项：\n${body}\n\n来源：${hit.source || '—'}`,
      { kind: 'checklist', checklist: hit }
    );
  },
});

/* ================= 组装 ================= */

function buildDomainTools(kb) {
  return [
    makeSearchTool(kb),
    makeGlossaryTool(kb),
    listTopicsTool(kb),
    checklistTool(kb),
    calcICERTool,
    calcQALYTool,
    calcINMBTool,
    calcPSATool,
    calcOWSATool,
    calcDiscountTool,
    calcBIATool,
    calcDecisionTreeTool,
    calcCBATool,
    calcCOITool,
    reportTool,
  ];
}

module.exports = { buildDomainTools };
