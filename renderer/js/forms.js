/**
 * 计算器表单定义与渲染
 * ---------------------------------------------------------------
 * 面向不熟悉电脑操作的用户：
 *  · 每个字段都有常驻中文标签，不用 placeholder 代替
 *  · 关键字段配"提示条"解释怎么填
 *  · 数字输入用 inputmode="decimal"，移动端直接弹数字键盘
 *  · 单位写在输入框后缀里，不需要用户猜
 *  · 复杂结构（健康状态、现金流、情景）用"可增删的行"
 *  · PSA 提供简化模式（填 均值 + 变异系数），不用手写 JSON
 */
(function (global) {
  'use strict';

  const MD = global.MD;

  /* ============ 表单定义 ============ */

  const FORMS = {
    calc_qaly: {
      name: 'QALY 计算',
      desc: '把健康状态换算成可加总的年数',
      icon: 'functions',
      fields: [
        { type: 'hint', text: '效用值 = 该健康状态相当于多少个健康人。0 = 死亡，1 = 完全健康，0.6 表示"0.6 个健康人活一年"。' },
        {
          type: 'rows',
          key: 'states',
          label: '健康状态',
          addLabel: '添加一个健康状态',
          min: 1,
          columns: [
            { key: 'label', label: '状态名称', type: 'text', placeholder: '如：有症状、能自理', width: '2fr' },
            { key: 'utility', label: '效用值', type: 'number', min: 0, max: 1, step: 0.01, suffix: '0~1', width: '1fr' },
            { key: 'duration', label: '持续年数', type: 'number', min: 0, step: 0.5, suffix: '年', width: '1fr' },
          ],
        },
      ],
      presets: [{ args: { states: [{ label: '有症状、能自理', utility: 0.8, duration: 2 }, { label: '重度受限、需照护', utility: 0.5, duration: 3 }] } }],
    },

    calc_icer: {
      name: 'ICER 增量成本效果比',
      desc: '多买 1 个 QALY 要多花多少钱',
      icon: 'calculate',
      fields: [
        { type: 'hint', text: '填两个方案的「总成本」和「总效果」。注意是总量，不是每人每年。' },
        {
          type: 'group',
          label: '对照方案（现有治疗）',
          children: [
            { type: 'number', key: 'cost_comparator', label: '总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_comparator', label: '总效果', suffix: 'QALY', step: 0.001, required: true },
          ],
        },
        {
          type: 'group',
          label: '新方案（要评估的方案）',
          children: [
            { type: 'number', key: 'cost_intervention', label: '总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_intervention', label: '总效果', suffix: 'QALY', step: 0.001, required: true },
          ],
        },
        { type: 'number', key: 'threshold', label: '成本效果阈值（可不填）', suffix: '元/QALY', min: 0, hint: '填了就会自动判断"新方案值不值"。不确定就不填。' },
      ],
      presets: [
        { label: '典型示例（值得看）', args: { cost_comparator: 100000, effect_comparator: 3.0, cost_intervention: 160000, effect_intervention: 3.4, threshold: 100000 } },
        { label: '反向示例（更贵且更差）', args: { cost_comparator: 100000, effect_comparator: 3.4, cost_intervention: 160000, effect_intervention: 3.0 } },
      ],
    },

    calc_inmb: {
      name: 'INMB 净货币效益',
      desc: '换个阈值看结论会不会翻转',
      icon: 'insights',
      fields: [
        { type: 'hint', text: 'INMB = Δ成本 − 阈值 × Δ效果。结果为正表示在这个阈值下新方案更值得采用。' },
        {
          type: 'group',
          label: '对照方案',
          children: [
            { type: 'number', key: 'cost_comparator', label: '总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_comparator', label: '总效果', suffix: 'QALY', step: 0.001, required: true },
          ],
        },
        {
          type: 'group',
          label: '新方案',
          children: [
            { type: 'number', key: 'cost_intervention', label: '总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_intervention', label: '总效果', suffix: 'QALY', step: 0.001, required: true },
          ],
        },
        { type: 'number', key: 'threshold', label: '阈值 λ', suffix: '元/QALY', min: 0, required: true },
      ],
    },

    calc_psa: {
      name: 'PSA 概率敏感性分析',
      desc: '让参数带上随机性，看结论有多可靠',
      icon: 'stacked_line_chart',
      fields: [
        {
          type: 'hint',
          text: 'PSA 要给每个参数设一个"分布"，而不是一个固定值。' +
            '变异系数 cv = 标准差÷均值，数值越大表示越不确定。成本常用对数正态，效用值常用 Beta 分布。',
        },
        {
          type: 'group',
          label: '对照方案',
          children: [
            { type: 'number', key: '_c0_mean', label: '成本均值', suffix: '元', min: 0, required: true },
            { type: 'number', key: '_c0_cv', label: '成本变异系数 cv', suffix: '', min: 0, max: 3, step: 0.05, required: true, hint: '药品成本常用 0.25' },
            { type: 'number', key: '_e0_mean', label: '效果均值', suffix: 'QALY', step: 0.001, required: true },
            { type: 'number', key: '_e0_se', label: '效果标准误 se', suffix: '', min: 0, step: 0.01, required: true, hint: '证据越充分，se 越小。效用值常用 0.10' },
          ],
        },
        {
          type: 'group',
          label: '新方案',
          children: [
            { type: 'number', key: '_c1_mean', label: '成本均值', suffix: '元', min: 0, required: true },
            { type: 'number', key: '_c1_cv', label: '成本变异系数 cv', suffix: '', min: 0, max: 3, step: 0.05, required: true },
            { type: 'number', key: '_e1_mean', label: '效果均值', suffix: 'QALY', step: 0.001, required: true },
            { type: 'number', key: '_e1_se', label: '效果标准误 se', suffix: '', min: 0, step: 0.01, required: true },
          ],
        },
        { type: 'number', key: 'lambda', label: '分析阈值 λ', suffix: '元/QALY', min: 0, required: true },
        { type: 'number', key: 'n', label: '抽样次数', suffix: '次', min: 100, max: 20000, step: 100, value: 2000, hint: '一般 1000～5000 次就够。次数越多越准但越慢。' },
        { type: 'number', key: 'seed', label: '随机种子', suffix: '', step: 1, value: 20240101, hint: '同一个种子必然得到同一个结果，方便你反复对照参数变化。' },
      ],
      presets: [
        {
          label: '典型示例',
          args: {
            _c0_mean: 100000, _c0_cv: 0.25, _e0_mean: 3.0, _e0_se: 0.10,
            _c1_mean: 160000, _c1_cv: 0.25, _e1_mean: 3.4, _e1_se: 0.10,
            lambda: 100000, n: 2000, seed: 20240101,
          },
        },
      ],
    },

    calc_owsa: {
      name: '单因素敏感性分析',
      desc: '找出最影响结论的那个参数',
      icon: 'trending',
      fields: [
        { type: 'hint', text: '每行一个参数，填"当它变成最乐观 / 最悲观值时，成本或效果会变化多少"。例如成本可能范围 8 万～15 万，相对基准 +60000 和 -20000。' },
        {
          type: 'group',
          label: '基准方案',
          children: [
            { type: 'number', key: 'cost_comparator', label: '对照总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_comparator', label: '对照总效果', suffix: 'QALY', step: 0.001, required: true },
            { type: 'number', key: 'cost_intervention', label: '新方案总成本', suffix: '元', min: 0, required: true },
            { type: 'number', key: 'effect_intervention', label: '新方案总效果', suffix: 'QALY', step: 0.001, required: true },
          ],
        },
        { type: 'number', key: 'threshold', label: '阈值 λ', suffix: '元/QALY', min: 0, required: true },
        {
          type: 'rows',
          key: 'parameters',
          label: '待测试的参数',
          addLabel: '添加一个参数',
          min: 1,
          columns: [
            { key: 'name', label: '参数名', type: 'text', placeholder: '如：药费单价', width: '2fr' },
            { key: 'lowDelta', label: '最悲观时的改变量', type: 'number', step: 1, suffix: '元', width: '1fr' },
            { key: 'highDelta', label: '最乐观时的改变量', type: 'number', step: 1, suffix: '元', width: '1fr' },
          ],
        },
      ],
    },

    calc_discount: {
      name: '折现（现值）计算',
      desc: '把不同年份的钱和效果换算到今天',
      icon: 'percent',
      fields: [
        { type: 'hint', text: '第 0 年 = 现在，不折现。中国指南（2020版）规定成本与健康产出同率 5%/年，敏感性分析用 0%–8%。' },
        { type: 'number', key: 'rate', label: '折现率', suffix: '%', min: 0, max: 30, step: 0.1, required: true, hint: '填 5 表示 5%。' },
        {
          type: 'rows',
          key: 'flows',
          label: '各年数据',
          addLabel: '添加一年',
          min: 1,
          columns: [
            { key: 'year', label: '第几年', type: 'number', min: 0, step: 1, suffix: '年', width: '1fr' },
            { key: 'cost', label: '当年成本', type: 'number', min: 0, step: 100, suffix: '元', width: '1.2fr' },
            { key: 'effect', label: '当年效果', type: 'number', min: 0, step: 0.01, suffix: 'QALY', width: '1.2fr' },
          ],
        },
        { type: 'checkbox', key: 'discount_effect', label: '效果也一起折现', value: true, hint: '中国指南与多数国际指南的做法。取消勾选则只折现成本。' },
      ],
    },

    calc_bia: {
      name: '预算影响分析',
      desc: '这个新药上市后要多花多少钱',
      icon: 'account_balance',
      fields: [
        { type: 'hint', text: '渗透率和替代率都填 0～1 之间的小数：5% 要写 0.05。替代率指"新药病人里有多少本来就在用老治疗"。' },
        { type: 'number', key: 'eligible', label: '目标人群总人数', suffix: '人', min: 0, required: true },
        { type: 'number', key: 'uptake_before', label: '现有治疗的渗透率', suffix: '0~1', min: 0, max: 1, step: 0.01, required: true, hint: '如 10% 填 0.1' },
        { type: 'number', key: 'uptake_after', label: '新方案渗透率', suffix: '0~1', min: 0, max: 1, step: 0.01, required: true },
        { type: 'number', key: 'annual_cost_before', label: '原有治疗每人每年成本', suffix: '元', min: 0, required: true },
        { type: 'number', key: 'annual_cost_after', label: '新方案每人每年成本', suffix: '元', min: 0, required: true },
        { type: 'number', key: 'displaceable', label: '可被替代的比例', suffix: '0~1', min: 0, max: 1, step: 0.01, value: 0.3, hint: '别漏掉这一项！漏了会严重高估预算影响。' },
        { type: 'number', key: 'horizon', label: '预算影响年限', suffix: '年', min: 1, max: 10, step: 1, value: 5 },
      ],
    },

    calc_decision_tree: {
      name: '决策树期望值',
      desc: '算期望成本与期望效果',
      icon: 'account_tree',
      fields: [
        { type: 'hint', text: '每个策略下面的各个结局，概率加起来必须等于 1。' },
        { type: 'number', key: 'threshold', label: '阈值 λ（可不填）', suffix: '元/QALY', min: 0, hint: '填了会额外算出期望 INMB 并挑出最优策略。' },
        {
          type: 'nested',
          key: 'strategies',
          label: '备选策略',
          addLabel: '添加一个策略',
          min: 1,
          rowTitle: '策略',
          columns: [
            { key: 'name', label: '策略名称', type: 'text', placeholder: '如：方案A（现有治疗）', width: '1fr' },
            {
              key: 'outcomes',
              label: '结局',
              type: 'subrows',
              addLabel: '添加一个结局',
              columns: [
                { key: 'prob', label: '发生概率', type: 'number', min: 0, max: 1, step: 0.01, suffix: '0~1' },
                { key: 'cost', label: '结局成本', type: 'number', min: 0, step: 100, suffix: '元' },
                { key: 'effect', label: '结局效果', type: 'number', step: 0.001, suffix: 'QALY' },
              ],
            },
          ],
        },
      ],
    },

    calc_cba: {
      name: '成本-效益分析',
      desc: '把收益也算成钱，算净现值',
      icon: 'account_balance',
      fields: [
        { type: 'hint', text: '成本-效益分析要求效果的货币价值已经确定（意愿支付法、生产率法等）。' },
        { type: 'number', key: 'total_benefit', label: '总收益', suffix: '元', required: true },
        { type: 'number', key: 'total_cost', label: '总成本', suffix: '元', min: 0, required: true },
      ],
    },

    calc_coi: {
      name: '疾病成本',
      desc: '算清这个病每年花多少钱',
      icon: 'stacked_line_chart',
      fields: [
        { type: 'hint', text: '患病率要填小数：5% 写 0.05。患病率法简单但会重复计入病程早期成本，正式研究建议用发病率法。' },
        { type: 'number', key: 'population', label: '目标人群', suffix: '人', min: 0, required: true },
        { type: 'number', key: 'prevalence', label: '患病率', suffix: '0~1 小数', min: 0, max: 1, step: 0.001, required: true, hint: '如 5% 填 0.05' },
        { type: 'number', key: 'annual_cost_per_case', label: '每例患者年成本', suffix: '元', min: 0, required: true },
        {
          type: 'select',
          key: 'method',
          label: '计算方法',
          options: [
            { value: 'prevalence', label: '患病率法（简单快速）' },
            { value: 'incidence', label: '发病率法（更严谨）' },
          ],
        },
      ],
    },
  };

  /* ============ 表单渲染 ============ */

  let uid = 0;
  const nid = () => `f${++uid}`;

  function fieldHTML(f, value) {
    const id = nid();
    switch (f.type) {
      case 'hint':
        return `<div class="field__hint">${MD.render(f.text)}</div>`;

      case 'number':
      case 'text': {
        const v = value !== undefined && value !== null && value !== '' ? value : f.value !== undefined ? f.value : '';
        const attrs = [
          `id="${id}"`,
          `class="input"`,
          // data-key 是 readArgs 读取数值的唯一依据，缺了整张表单都读不到值
          `data-key="${f.key}"`,
          f.type === 'number'
            ? `type="number" inputmode="decimal" ${f.step ? `step="${f.step}"` : ''}`
            : `type="text"`,
          f.min !== undefined ? `min="${f.min}"` : '',
          f.max !== undefined ? `max="${f.max}"` : '',
          `value="${MD.esc(v)}"`,
        ].join(' ');
        const inner = f.suffix
          ? `<div class="input-group"><input ${attrs} /><span class="input-group__suffix">${MD.esc(f.suffix)}</span></div>`
          : `<input ${attrs} />`;
        return `
          <div class="field">
            <label class="field__label" for="${id}">${MD.render(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
            ${inner}
            ${f.hint ? `<div class="field__hint">${MD.render(f.hint)}</div>` : ''}
            <div class="field__error" hidden></div>
          </div>`;
      }

      case 'checkbox':
        return `
          <label class="check">
            <input type="checkbox" data-key="${f.key}" ${value || f.value ? 'checked' : ''} />
            <span class="check__text">${MD.render(f.label)}${f.hint ? `<span class="check__desc">${MD.render(f.hint)}</span>` : ''}</span>
          </label>`;

      case 'select':
        return `
          <div class="field">
            <label class="field__label" for="${id}">${MD.render(f.label)}</label>
            <select id="${id}" class="select" data-key="${f.key}">
              ${f.options.map((o) => `<option value="${MD.esc(o.value)}" ${String(value ?? f.value) === o.value ? 'selected' : ''}>${MD.esc(o.label)}</option>`).join('')}
            </select>
            ${f.hint ? `<div class="field__hint">${MD.render(f.hint)}</div>` : ''}
          </div>`;

      case 'group':
        return `
          <fieldset style="border:2px solid var(--md-outline-variant);border-radius:var(--shape-md);padding:var(--sp-4);margin:0 0 var(--sp-4)">
            <legend style="font:600 var(--type-body-medium);padding:0 var(--sp-2)">${MD.render(f.label)}</legend>
            <div class="field-row">${f.children.map((c) => fieldHTML(c, value ? value[c.key] : undefined)).join('')}</div>
          </fieldset>`;

      case 'rows': {
        const rows = Array.isArray(value) && value.length ? value : [blankRow(f.columns)];
        return `
          <div class="field">
            <span class="field__label">${MD.render(f.label)}</span>
            <div data-rows="${f.key}" data-min="${f.min || 1}">
              ${rows.map((r, i) => rowsHTML(f, r, i)).join('')}
            </div>
            <button type="button" class="btn btn--tonal btn--sm" data-add-row="${f.key}" style="margin-top:var(--sp-2)">
              <span data-icon="check" aria-hidden="true" style="transform:rotate(45deg)"></span>
              <span class="btn__label">${MD.esc(f.addLabel || '添加一行')}</span>
            </button>
          </div>`;
      }

      case 'nested': {
        const rows = Array.isArray(value) && value.length ? value : [{}];
        return `
          <div class="field">
            <span class="field__label">${MD.render(f.label)}</span>
            <div data-rows="${f.key}" data-min="${f.min || 1}" data-nested="1">
              ${rows.map((r, i) => rowsHTML(f, r, i)).join('')}
            </div>
            <button type="button" class="btn btn--tonal btn--sm" data-add-row="${f.key}" style="margin-top:var(--sp-2)">
              <span data-icon="check" aria-hidden="true" style="transform:rotate(45deg)"></span>
              <span class="btn__label">${MD.esc(f.addLabel || '添加一项')}</span>
            </button>
          </div>`;
      }

      default:
        return '';
    }
  }

  function blankRow(columns) {
    const o = {};
    columns.forEach((c) => { o[c.key] = c.type === 'number' ? '' : ''; });
    return o;
  }

  function rowsHTML(f, row, index) {
    const inputs = f.columns
      .map((c) => {
        if (c.type === 'subrows') {
          const subs = Array.isArray(row[c.key]) && row[c.key].length ? row[c.key] : [blankRow(c.columns)];
          return `
            <div style="width:100%;margin-top:var(--sp-2)">
              <div style="font:500 var(--type-label-small);color:var(--md-on-surface-variant);margin-bottom:var(--sp-1)">${MD.esc(c.label)}</div>
              ${subs.map((s, si) => `<div class="field-row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)">
                ${c.columns.map((sc) => subInputHTML(sc, s[sc.key])).join('')}
                ${subs.length > 1 ? `<button type="button" class="icon-btn" data-del-subrow="${si}" aria-label="删除这个结局" title="删除这个结局"><span data-icon="close" aria-hidden="true"></span></button>` : ''}
              </div>`).join('')}
              <button type="button" class="btn btn--text btn--sm" data-add-subrow>
                <span data-icon="check" aria-hidden="true" style="transform:rotate(45deg)"></span>
                <span class="btn__label">${MD.esc(c.addLabel || '添加')}</span>
              </button>
            </div>`;
        }
        return inputHTML(c, row ? row[c.key] : '', index);
      })
      .join('');

    return `
      <div class="card card--outlined" data-row="${index}" style="margin-bottom:var(--sp-3)">
        <div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2)">
          <span class="entry__badge">${MD.esc(f.rowTitle || '第')} ${index + 1} 项</span>
          <div style="flex:1"></div>
          <button type="button" class="icon-btn" data-del-row aria-label="删除这一项" title="删除这一项"><span data-icon="trash" aria-hidden="true"></span></button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:flex-end">${inputs}</div>
      </div>`;
  }

  function inputHTML(c, val, rowIndex) {
    const id = `${rowIndex}_${c.key}_${nid()}`;
    const attrs = [
      `id="${id}"`,
      `data-col="${c.key}"`,
      `data-row="${rowIndex}"`,
      `class="input"`,
      c.type === 'number'
        ? `type="number" inputmode="decimal" ${c.step ? `step="${c.step}"` : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''}`
        : `type="text"`,
      `value="${MD.esc(val ?? '')}"`,
      c.placeholder ? `placeholder="${MD.esc(c.placeholder)}"` : '',
    ].join(' ');
    const w = c.width ? `style="flex:${c.width};min-width:130px"` : 'style="flex:1;min-width:130px"';
    return `
      <div class="field" style="margin:0;${w}">
        <label class="field__label" for="${id}">${MD.esc(c.label)}</label>
        ${c.suffix
          ? `<div class="input-group"><input ${attrs} /><span class="input-group__suffix">${MD.esc(c.suffix)}</span></div>`
          : `<input ${attrs} />`}
      </div>`;
  }

  function subInputHTML(c, val) {
    const attrs = [
      `data-subcol="${c.key}"`,
      `class="input"`,
      c.type === 'number'
        ? `type="number" inputmode="decimal" ${c.step ? `step="${c.step}"` : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''}`
        : `type="text"`,
      `value="${MD.esc(val ?? '')}"`,
      c.placeholder ? `placeholder="${MD.esc(c.placeholder)}"` : '',
    ].join(' ');
    return `
      <div class="field" style="margin:0;flex:1;min-width:110px">
        <label class="field__label">${MD.esc(c.label)}</label>
        ${c.suffix
          ? `<div class="input-group"><input ${attrs} /><span class="input-group__suffix">${MD.esc(c.suffix)}</span></div>`
          : `<input ${attrs} />`}
      </div>`;
  }

  /* ============ 取值 ============ */

  /** 从表单 DOM 读取参数值 */
  function readArgs(container, form) {
    const args = {};
    // 普通字段
    container.querySelectorAll('[data-key]').forEach((el) => {
      const k = el.getAttribute('data-key');
      if (k.startsWith('_')) return; // PSA 内部字段另行处理
      if (el.type === 'checkbox') args[k] = el.checked;
      else if (el.tagName === 'SELECT') args[k] = el.value;
      else args[k] = coerce(el.value, el.type === 'number');
    });

    // rows / nested
    container.querySelectorAll('[data-rows]').forEach((box) => {
      const key = box.getAttribute('data-rows');
      const isNested = box.getAttribute('data-nested') === '1';
      const rowBoxes = [...box.querySelectorAll(':scope > [data-row]')];
      args[key] = rowBoxes.map((rb) => {
        const o = {};
        rb.querySelectorAll('[data-col]').forEach((inp) => {
          o[inp.getAttribute('data-col')] = coerce(inp.value, inp.type === 'number');
        });
        if (isNested) {
          const sub = rb.querySelector('[data-subcol]');
          const subBox = sub ? sub.closest('[data-row]') : null;
          const outcomes = [];
          if (subBox) {
            // 结局的子行由 card 内的 field-row 承载，用 data-subrow 标记
          }
          o.__outcomes = [...rb.querySelectorAll('.field-row')]
            .map((fr) => {
              const oo = {};
              fr.querySelectorAll('[data-subcol]').forEach((inp) => {
                oo[inp.getAttribute('data-subcol')] = coerce(inp.value, inp.type === 'number');
              });
              return oo;
            })
            .filter((x) => Object.keys(x).some((k2) => x[k2] !== '' && x[k2] !== null));
        }
        return o;
      });
    });

    // PSA 简化字段 → 分布 JSON
    if (form === 'calc_psa') {
      const cv0 = num(args._c0_cv, 0.25);
      const cv1 = num(args._c1_cv, 0.25);
      const se0 = num(args._e0_se, 0.1);
      const se1 = num(args._e1_se, 0.1);
      args.c0 = JSON.stringify({ type: 'lognormal', mean: num(args._c0_mean), cv: cv0 });
      args.c1 = JSON.stringify({ type: 'lognormal', mean: num(args._c1_mean), cv: cv1 });
      args.e0 = JSON.stringify({ type: 'beta', mean: num(args._e0_mean), se: se0 });
      args.e1 = JSON.stringify({ type: 'beta', mean: num(args._e1_mean), se: se1 });
      delete args._c0_mean; delete args._c0_cv; delete args._e0_mean; delete args._e0_se;
      delete args._c1_mean; delete args._c1_cv; delete args._e1_mean; delete args._e1_se;
    }

    // OWSA 的 low/high 改写成 delta 对
    if (form === 'calc_owsa' && Array.isArray(args.parameters)) {
      args.parameters = args.parameters
        .filter((p) => p && p.name)
        .map((p) => ({
          name: String(p.name),
          deltaC0: num(p.lowDelta, 0) / 2,
          deltaC1: -num(p.highDelta, 0) / 2,
        }));
    }

    // 决策树：整理策略结构
    if (form === 'calc_decision_tree' && Array.isArray(args.strategies)) {
      args.strategies = args.strategies
        .filter((s) => s && (s.name || (s.__outcomes || []).length))
        .map((s, i) => ({
          name: String(s.name || `策略${i + 1}`),
          outcomes: (s.__outcomes || []).filter((o) => o.prob !== '' && o.prob !== null),
        }));
      delete args.strategies.outcomes;
    }

    // 折现：排序并去掉空行
    if (form === 'calc_discount' && Array.isArray(args.flows)) {
      args.flows = args.flows
        .filter((f) => f && f.cost !== '' && f.cost !== null)
        .map((f) => ({ year: num(f.year, 0), cost: num(f.cost, 0), effect: num(f.effect, 0) }))
        .sort((a, b) => a.year - b.year);
    }

    if (form === 'calc_qaly' && Array.isArray(args.states)) {
      args.states = args.states
        .filter((s) => s && s.utility !== '' && s.duration !== '')
        .map((s, i) => ({ label: String(s.label || `状态${i + 1}`), utility: num(s.utility), duration: num(s.duration) }));
    }

    return args;
  }

  function coerce(v, isNum) {
    if (v === '' || v === null || v === undefined) return isNum ? null : '';
    return isNum ? Number(v) : v;
  }
  function num(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  /** 客户端预校验，给出"哪里没填"的中文提示 */
  function validate(args, form) {
    const errs = [];
    const req = [
      ['cost_comparator', '对照方案的总成本'],
      ['effect_comparator', '对照方案的总效果'],
      ['cost_intervention', '新方案的总成本'],
      ['effect_intervention', '新方案的总效果'],
    ];
    for (const [k, label] of req) {
      if (k in args && (args[k] === null || args[k] === '')) errs.push(`请填写「${label}」`);
    }
    if ('threshold' in args && args.threshold === null) errs.push('阈值可以不填；如果要填，请填数字');
    if ('lambda' in args && !Number.isFinite(args.lambda)) errs.push('请填写阈值 λ');
    if (form === 'calc_qaly' && (!args.states || !args.states.length)) errs.push('请至少添加一个健康状态');
    if (form === 'calc_qaly' && args.states) {
      for (const s of args.states) {
        if (s.utility < 0 || s.utility > 1) errs.push(`「${s.label}」的效用值必须在 0～1 之间（现在填的是 ${s.utility}）`);
      }
    }
    if (form === 'calc_bia') {
      for (const k of ['uptake_before', 'uptake_after', 'displaceable']) {
        if (k in args && args[k] !== null && (args[k] < 0 || args[k] > 1)) {
          errs.push(`「${k}」要填 0～1 之间的小数（10% 请写 0.1），现在是 ${args[k]}`);
        }
      }
    }
    if (form === 'calc_coi' && args.prevalence !== null && args.prevalence > 1) {
      errs.push(`患病率请填 0～1 之间的小数（5% 请写 0.05），现在是 ${args.prevalence}`);
    }
    if (form === 'calc_decision_tree' && Array.isArray(args.strategies)) {
      for (const s of args.strategies) {
        if (!s.outcomes.length) errs.push(`「${s.name}」还没有填写结局`);
        else {
          const sum = s.outcomes.reduce((a, o) => a + (Number(o.prob) || 0), 0);
          if (Math.abs(sum - 1) > 0.02) errs.push(`「${s.name}」的概率加起来是 ${sum.toFixed(2)}，应该等于 1`);
        }
      }
    }
    if (form === 'calc_owsa' && (!args.parameters || !args.parameters.length)) errs.push('请至少添加一个待测试的参数');
    return errs;
  }

  global.FORMS = FORMS;
  global.FormKit = { fieldHTML, readArgs, validate, blankRow };
})(window);
