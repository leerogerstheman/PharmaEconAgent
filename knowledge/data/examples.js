/** 教学示例 —— 每个分析类型一个可复现的完整算例，供「示例」页一键载入计算器 */
module.exports = [
  {
    id: 'icer-demo',
    title: 'ICER 计算示例：两种降压方案',
    summary: '最基础也最常考的 ICER 计算。',
    tool: 'calc_icer',
    args: {
      cost_comparator: 100000,
      effect_comparator: 3.0,
      cost_intervention: 160000,
      effect_intervention: 3.4,
      threshold: 100000,
    },
    teachingNote:
      '注意顺序：ΔC = 60000，ΔE = 0.4，ICER = 150,000 元/QALY。' +
      '因为 ΔE > 0 且 ΔC > 0，落在 NE- 象限，必须与阈值比较——' +
      '这一步先看平面、再谈比值，是最容易被忽略的顺序。',
  },
  {
    id: 'icer-dominated',
    title: '反向示例：新方案更贵且更差',
    summary: '故意构造"被支配"方案，演示为什么 ICER 数值再好看也不能采用。',
    tool: 'calc_icer',
    args: {
      cost_comparator: 100000,
      effect_comparator: 3.4,
      cost_intervention: 160000,
      effect_intervention: 3.0,
    },
    teachingNote:
      'ΔC = +60000，ΔE = −0.4，ICER = −150,000。' +
      '如果只盯着"ICER 是负数、是负的比省钱"，就会得出完全错误的结论。' +
      '软件会直接判定为 SW- 象限（被对照方案完全支配），应放弃该方案。' +
      '这一条建议作为作业中"判断结论是否与数据一致"的训练。',
  },
  {
    id: 'qaly-demo',
    title: 'QALY 计算示例：两段健康状态',
    summary: '手算一遍 QALY 公式。',
    tool: 'calc_qaly',
    args: {
      states: [
        { label: '有症状、能自理', utility: 0.8, duration: 2 },
        { label: '重度受限、需照护', utility: 0.5, duration: 3 },
      ],
    },
    teachingNote:
      '0.80 × 2 + 0.50 × 3 = 1.6 + 1.5 = 3.1 QALY。' +
      '若 5 年完全健康应是 5.0 QALY，所以这个病人损失了 1.9 QALY——' +
      '治疗方案要争取的就是这 1.9。试着把效用值填 8 看看软件的提示。',
  },
  {
    id: 'inmb-demo',
    title: 'INMB 计算示例：换个阈值看结论',
    summary: '同一组数据，只改阈值，结论就翻转。',
    tool: 'calc_inmb',
    args: {
      cost_comparator: 100000,
      effect_comparator: 3.0,
      cost_intervention: 160000,
      effect_intervention: 3.4,
      threshold: 100000,
    },
    teachingNote:
      'λ = 100000 时 INMB = 60000 − 100000×0.4 = +20000，结论是"值得"。' +
      '把 λ 改成 200000，INMB = 60000 − 80000 = −20000，结论翻转成"不值得"。' +
      '这说明阈值不是一个客观事实，而是决策者的价值判断——' +
      '所以主流规范要求报告 CEAC 而不是只报一个 ICER 对比。',
  },
  {
    id: 'psa-demo',
    title: 'PSA 示例：随机抽样与可接受概率',
    summary: '体会"不确定性"如何变成一条曲线。',
    tool: 'calc_psa',
    args: {
      c0: '{"type":"lognormal","mean":100000,"cv":0.25}',
      c1: '{"type":"lognormal","mean":160000,"cv":0.25}',
      e0: '{"type":"beta","mean":0.6,"se":0.1}',
      e1: '{"type":"beta","mean":0.7,"se":0.1}',
      lambda: 100000,
      n: 2000,
      seed: 20240101,
    },
    teachingNote:
      '同参数同种子必得同结果，可以放心地反复调参数观察变化。' +
      '把 c1 的 mean 改成 140000，看可接受概率怎么跳变；' +
      '再把 e1 的 se 改成 0.02（证据更精确），看曲线是否变陡。' +
      '这正是 EVSI 思维——"不确定性减少之后，结论能更确定吗"。',
  },
  {
    id: 'bia-demo',
    title: 'BIA 示例：一个慢病新药的预算账',
    summary: '理解"花多少钱"和"值不值"的区别。',
    tool: 'calc_bia',
    args: {
      eligible: 1000000,
      uptake_before: 0.1,
      uptake_after: 0.4,
      annual_cost_before: 5000,
      annual_cost_after: 20000,
      displaceable: 0.3,
      horizon: 5,
    },
    teachingNote:
      '关键是被替代掉的成本：40 万 × 30% × 5000 元 = 600 万元/年被挤出。' +
      '漏掉这一项会严重高估预算影响。' +
      '接着把 displaceable 改成 0 再算一次，对比两个结果的差距。',
  },
  {
    id: 'discount-demo',
    title: '折现示例：3 年现金流',
    summary: '亲手算一遍现值，理解折现率的影响。',
    tool: 'calc_discount',
    args: {
      flows: [
        { year: 0, cost: 10000, effect: 0.2 },
        { year: 1, cost: 10000, effect: 0.2 },
        { year: 2, cost: 10000, effect: 0.2 },
      ],
      rate: 5,
      discount_effect: true,
    },
    teachingNote:
      '总成本现值 28,594 元，总效果现值 0.5719 QALY。' +
      '把 rate 改成 0 对比一次（30000 元 vs 0.6 QALY），' +
      '你会发现成本增幅小于效果增幅，因此 ICER 会上升——' +
      '这正是 2020 版指南要求做 0%–8% 折现敏感性分析的原因。',
  },
  {
    id: 'decision-demo',
    title: '决策树示例：要不要进一步研究',
    summary: '用 EVSI 回答"这个试验值不值得做"。',
    tool: 'calc_decision_tree',
    args: {
      strategies: [
        {
          name: '方案A（现有治疗）',
          outcomes: [
            { prob: 0.5, cost: 100000, effect: 3.0 },
            { prob: 0.5, cost: 120000, effect: 3.2 },
          ],
        },
        {
          name: '方案B（新药）',
          outcomes: [
            { prob: 0.5, cost: 150000, effect: 3.3 },
            { prob: 0.5, cost: 180000, effect: 3.6 },
          ],
        },
      ],
      threshold: 100000,
    },
    teachingNote:
      '先算各策略的期望成本与效果，再比 INMB。' +
      '接下来问：如果做一次 30 万元的临床试验，能把结局概率变得更确定，' +
      'EVSI 会是多少？EVSI > 30 万就说明这项试验值得做。',
  },
];
