/**
 * 药物经济学数学内核
 * ---------------------------------------------------------------
 * 纯函数模块：不依赖任何第三方库与 LLM，保证离线可用、数值可复现。
 * 所有随机抽样使用可播种的确定性 PRNG（mulberry32），
 * 同一 seed + 同一输入必得同一结果 —— 这一点对教学场景至关重要，
 * 学生重跑 PSA 能得到完全一致的 CEAC，不会怀疑软件"乱数"。
 */

/* ============ 确定性随机数 ============ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller 正态分布 */
function normal(rand, mu = 0, sigma = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mu + sigma * z;
}

/** Marsaglia-Tsang Gamma 分布（shape>0, scale>0） */
function gamma(rand, shape, scale) {
  if (shape < 1) {
    // Johnk's boost：U^(1/shape) * Gamma(shape+1)
    return gamma(rand, shape + 1, scale) * Math.pow(Math.max(rand(), 1e-12), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = normal(rand, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** Beta 分布（用两个 Gamma 之比实现，a,b>0） */
function beta(rand, a, b) {
  const x = gamma(rand, a, 1);
  const y = gamma(rand, b, 1);
  const s = x + y;
  return s === 0 ? a / (a + b) : x / s;
}

/** 对数正态（lnX ~ N(mu, sigma)） */
function logNormal(rand, mu, sigma) {
  return Math.exp(normal(rand, mu, sigma));
}

/** 三角分布 */
function triangular(rand, low, mode, high) {
  const u = rand();
  const c = (mode - low) / (high - low);
  if (u < c) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

/* ============ 分布采样调度 ============ */

/**
 * 从参数化分布采样。参数形态：
 *  {type:'uniform', min, max}
 *  {type:'normal', mean, sd}
 *  {type:'gamma', shape, scale}  |  {type:'gamma', mean, cv}   // mean+cv → shape/scale
 *  {type:'beta', alpha, beta}    |  {type:'beta', mean, se}    // 均值+标准误
 *  {type:'lognormal', mu, sigma} |  {type:'lognormal', mean, cv}
 *  {type:'triangular', low, mode, high}
 *  {type:'fixed', value}
 *  数字本身 → 视为 fixed
 */
function sample(rand, dist) {
  if (dist === null || dist === undefined) return NaN;
  if (typeof dist === 'number') return dist;
  const t = dist.type;
  switch (t) {
    case 'fixed':
      return Number(dist.value);
    case 'uniform':
      return dist.min + rand() * (dist.max - dist.min);
    case 'normal':
      return normal(rand, Number(dist.mean), Number(dist.sd));
    case 'gamma': {
      let { shape, scale } = dist;
      if (shape === undefined && dist.mean !== undefined) {
        // 均值 + 变异系数反解：shape = 1/cv²，scale = mean·cv²
        const cv = dist.cv ?? 0.3;
        shape = 1 / (cv * cv);
        scale = dist.mean * cv * cv;
      }
      if (scale === undefined && dist.mean !== undefined) shape = shape ?? 1;
      return gamma(rand, shape, scale ?? 1);
    }
    case 'beta': {
      if (dist.alpha !== undefined) return beta(rand, dist.alpha, dist.beta);
      // 均值 + 标准误 → alpha/beta
      const m = dist.mean;
      const v = (dist.se || 0.1) ** 2;
      const denom = m * (1 - m);
      const t2 = v > 0 ? m * (1 - m) / v - 1 : 30;
      return beta(rand, m * t2, (1 - m) * t2);
    }
    case 'lognormal': {
      if (dist.mu !== undefined) return logNormal(rand, dist.mu, dist.sigma);
      const cv = dist.cv ?? 0.25;
      const mu = Math.log(dist.mean) - 0.5 * Math.log(1 + cv * cv);
      const sigma = Math.sqrt(Math.log(1 + cv * cv));
      return logNormal(rand, mu, sigma);
    }
    case 'triangular':
      return triangular(rand, dist.low, dist.mode ?? dist.low, dist.high);
    default:
      return Number(dist.value ?? 0);
  }
}

/* ============ 基础经济学公式 ============ */

/** QALY = Σ(效用 × 时间)；DALY = Σ(权重 × 时间) */
function calcQALY(states) {
  // states: [{utility|qaly, duration}]
  let total = 0;
  for (const s of states) {
    const u = s.utility ?? s.qaly ?? 0;
    const d = s.duration ?? 0;
    total += u * d;
  }
  return total;
}

/** 增量成本效果比 */
function calcICER(c0, e0, c1, e1) {
  const dC = c1 - c0;
  const dE = e1 - e0;
  if (Math.abs(dE) < 1e-12) {
    return {
      ok: false,
      reason: '两种方案的效果差异为 0，ICER 无定义。请改用成本最小化分析(CMA)或检查效果数据。',
      deltaCost: dC,
      deltaEffect: dE,
    };
  }
  return { ok: true, deltaCost: dC, deltaEffect: dE, icer: dC / dE };
}

/** 增量净货币效益 INMB = ΔC − λ·ΔE */
function calcINMB(c0, e0, c1, e1, lambda) {
  return (c1 - c0) - lambda * (e1 - e0);
}

/** 成本效果平面四象限判定 */
function cePlane(c0, e0, c1, e1) {
  const dC = c1 - c0;
  const dE = e1 - e0;
  let quadrant;
  let verdict;
  if (dE > 0 && dC <= 0) {
    quadrant = 'NE';
    verdict = '新方案效果更好且更便宜 —— 强优势方案（dominant），应直接替代对照。';
  } else if (dE > 0 && dC > 0) {
    quadrant = 'NE-';
    verdict = '新方案效果更好但更贵 —— 需要看 ICER 是否低于阈值。';
  } else if (dE <= 0 && dC <= 0) {
    quadrant = 'SW';
    verdict = '新方案效果更差但也更便宜 —— 需权衡损失的效果是否值得节省的成本。';
  } else {
    quadrant = 'SW-';
    verdict = '新方案效果更差且更贵 —— 被对照方案完全支配（dominated），不应采用。';
  }
  return { deltaCost: dC, deltaEffect: dE, quadrant, verdict };
}

/** 净货币收益平均值 NMBA */
function calcNMBA(c0, e0, c1, e1, lambda) {
  return calcINMB(c0, e0, c1, e1, lambda);
}

/* ============ 敏感性分析 ============ */

/**
 * 单因素敏感性分析（OWSA / 龙卷风图数据）
 * @param {object} base   基准 {cost, effect}
 * @param {Array} params  [{name, low, high}] 参数在低/高值下的取值
 * @param {number} lambda 阈值
 */
function oneWaySA(base, params, lambda) {
  const baseICER = calcICER(base.c0, base.e0, base.c1, base.e1);
  const baseINMB = calcINMB(base.c0, base.e0, base.c1, base.e1, lambda);
  const rows = params.map((p) => {
    const res = { name: p.name, low: null, high: null, lowINMB: null, highINMB: null };
    // 每个参数同时影响成本与效果（可用 p.costEffect 说明方向）
    const ce = p.costEffect || 'both';
    const apply = (c0, e0, c1, e1) => {
      const icer = calcICER(c0, e0, c1, e1);
      return {
        icer: icer.ok ? icer.icer : null,
        icerNote: icer.ok ? null : icer.reason,
        inmb: calcINMB(c0, e0, c1, e1, lambda),
      };
    };
    if (ce === 'both' || ce === 'cost') {
      // 参数影响对照组与干预组成本
      res.low = apply(base.c0 + p.deltaC0, base.e0, base.c1 + p.deltaC1, base.e1);
      res.high = apply(base.c0 + p.deltaC0, base.e0, base.c1 + p.deltaC1, base.e1);
    } else {
      res.low = apply(base.c0, base.e0 + (p.deltaE0 ?? 0), base.c1, base.e1 + (p.deltaE1 ?? 0));
      res.high = res.low;
    }
    res.swing = Math.abs(
      (res.low.inmb - baseINMB) + (res.high.inmb - baseINMB)
    );
    return res;
  });
  rows.sort((a, b) => b.swing - a.swing);
  return { baseICER, baseINMB, lambda, rows };
}

/**
 * 概率敏感性分析（PSA）
 * @param {object} spec
 *   c0,c1,e0,e1  可以是数字，也可以是分布对象
 *   lambda, n, seed
 */
function PSA(spec) {
  const {
    c0, c1, e0, e1,
    lambda = 50000,
    n = 1000,
    seed = 20240101,
  } = spec;
  const rand = mulberry32(seed);
  const sims = [];
  for (let i = 0; i < n; i++) {
    const sc0 = sample(rand, c0);
    const sc1 = sample(rand, c1);
    const se0 = sample(rand, e0);
    const se1 = sample(rand, e1);
    sims.push({
      c0: sc0, c1: sc1, e0: se0, e1: se1,
      dC: sc1 - sc0,
      dE: se1 - se0,
      inmb: (sc1 - sc0) - lambda * (se1 - se0),
    });
  }
  const win = sims.filter((s) => s.inmb > 0).length;
  return {
    n,
    lambda,
    seed,
    sims,
    nmba: sims.reduce((a, s) => a + s.inmb, 0) / n,
    probCE: win / n,
    meanDeltaCost: sims.reduce((a, s) => a + s.dC, 0) / n,
    meanDeltaEffect: sims.reduce((a, s) => a + s.dE, 0) / n,
  };
}

/**
 * 成本效果可接受曲线 CEAC
 * @param {Array} psaResult PSA 结果
 * @param {number} lambdaMax 最大阈值
 * @param {number} steps    采样点数
 */
function ceac(psaResult, lambdaMax = 150000, steps = 61) {
  const lambdas = [];
  for (let i = 0; i < steps; i++) lambdas.push((lambdaMax * i) / (steps - 1));
  const curve = lambdas.map((lambda) => {
    const win = psaResult.sims.filter((s) => s.dC - lambda * s.dE > 0).length;
    return { lambda, probCE: win / psaResult.n };
  });
  // 概率首次达到 0.5 的阈值（成本效果可接受阈值 CEPT 估计）
  let cept = null;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].probCE >= 0.5) {
      const p0 = curve[i - 1];
      const p1 = curve[i];
      cept = p1.probCE === p0.probCE
        ? p1.lambda
        : p0.lambda + ((0.5 - p0.probCE) / (p1.probCE - p0.probCE)) * (p1.lambda - p0.lambda);
      break;
    }
  }
  return { curve, cept, lambdaMax };
}

/** 期望增量净效益的分布统计 */
function einbStats(psaResult) {
  const v = psaResult.sims.map((s) => s.inmb).sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * v.length)))];
  return {
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    sd: Math.sqrt(v.reduce((a, b) => a + (b - v.reduce((x, y) => x + y, 0) / v.length) ** 2, 0) / v.length),
    p5: q(0.05), p50: q(0.5), p95: q(0.95),
  };
}

/* ============ 折现 ============ */

/**
 * 未来现金流的现值
 * @param {Array} flows [{year, cost, effect}] 从 year=0 开始
 * @param {number} rate 折现率
 * @param {boolean} discountEffect 效果是否也折现（ICER 仍用未折现效果）
 */
function discount(flows, rate, discountEffect = true) {
  const r = rate / 100;
  let pvCost = 0;
  let pvEffectDisc = 0;
  let pvEffectUndisc = 0;
  const detail = [];
  for (const f of flows) {
    const df = Math.pow(1 + r, f.year);
    const c = (f.cost || 0) / df;
    const eU = f.effect || 0;
    const eD = discountEffect ? eU / df : eU;
    pvCost += c;
    pvEffectDisc += eD;
    pvEffectUndisc += eU;
    detail.push({ year: f.year, discountFactor: 1 / df, pvCost: c, pvEffect: eD });
  }
  return { pvCost, pvEffectDisc, pvEffectUndisc, rate, detail };
}

/* ============ 预算影响分析 BIA ============ */

/**
 * 预算影响分析
 * @param {object} p
 *   eligible       目标人群（人）
 *   annualEligible 每年新增可治疗人数（可选，缺省用 eligible）
 *   uptakeBefore/uptakeAfter 渗透率（0-1）
 *   annualCostBefore/annualCostAfter 单位年治疗成本
 *   displaceable  可被替代（挤出）的治疗比例
 */
function budgetImpact(p) {
  const {
    eligible = 0,
    annualEligible,
    uptakeBefore = 0,
    uptakeAfter = 0,
    annualCostBefore = 0,
    annualCostAfter = 0,
    displaceable = 0,
    horizon = 5,
  } = p;
  const pop = annualEligible ?? eligible;
  const nBefore = pop * uptakeBefore;
  const nAfter = pop * uptakeAfter;
  const grossBefore = nBefore * annualCostBefore;
  const grossAfter = nAfter * annualCostAfter;
  // 新药替代掉的原有治疗成本
  const displaced = nAfter * displaceable * annualCostBefore;
  const netAnnual = grossAfter - grossBefore - displaced;
  const total = netAnnual * horizon;
  return {
    eligible: pop,
    treatedBefore: nBefore,
    treatedAfter: nAfter,
    newlyTreated: nAfter - nBefore,
    grossCostBefore: grossBefore,
    grossCostAfter: grossAfter,
    displacedCost: displaced,
    netAnnualImpact: netAnnual,
    totalImpact: total,
    horizon,
    percentIncrease: grossBefore > 0 ? ((grossAfter - grossBefore) / grossBefore) * 100 : null,
  };
}

/* ============ 期望价值信息 EVSI（决策树常用） ============ */

/**
 * EVPI / EVSI
 * @param {Array} outcomes [{prob, value}] 结局的先验概率与经济价值
 * @param {object} perfect 完美信息下各结局的最优价值 {0: v0, 1: v1}
 * @param {object} partial  部分信息下的期望价值 {0: v0, 1: v1}
 */
function valueOfInformation(outcomes, perfect, partial) {
  let evWithCurrent = 0;
  for (const o of outcomes) evWithCurrent += o.prob * o.value;
  const evPerfect = outcomes.reduce((acc, o, i) => acc + o.prob * (perfect[i] ?? o.value), 0);
  const evPartial = outcomes.reduce((acc, o, i) => acc + o.prob * (partial[i] ?? o.value), 0);
  return { EVPI: evPerfect - evWithCurrent, EVSI: evPartial - evWithCurrent, evWithCurrent };
}

/* ============ 格式化助手 ============ */

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (a >= 1e4) return (v / 1e4).toFixed(2) + ' 万';
  return v.toFixed(digits);
}

function fmtICER(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '无定义（不可计算）';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(3)} 亿 / QALY`;
  if (a >= 1e4) return `${sign}${Math.round(a).toLocaleString('zh-CN')} / QALY`;
  return `${sign}${a.toFixed(3)} / QALY`;
}

function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

module.exports = {
  mulberry32, sample, normal, gamma, beta, logNormal, triangular,
  calcQALY, calcICER, calcINMB, calcNMBA, cePlane,
  oneWaySA, PSA, ceac, einbStats,
  discount, budgetImpact, valueOfInformation,
  fmtNum, fmtICER, fmtPct,
};
