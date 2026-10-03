/**
 * 功能视图渲染
 * ---------------------------------------------------------------
 * 每个导出函数返回一个 HTMLElement，由 app.js 挂载到 #content。
 * 统一约定：所有交互按钮都有可见文字标签，关键操作给中文反馈。
 */
(function (global) {
  'use strict';

  const MD = global.MD;
  const ICON = global.ICON;
  const FORMS = global.FORMS;

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    ICON.hydrate(t.content);
    return t.content.firstElementChild;
  }

  function viewWrap(inner) {
    return el(`<div class="view"><div class="view-inner">${inner}</div></div>`);
  }

  /* ============ 计算器视图 ============ */

  function calculatorView(api, examples) {
    global.EXAMPLES = examples || [];
    const names = Object.keys(FORMS);
    const wrap = el(`
      <div class="view">
        <div class="view-head">
          <h1 class="view-title">计算器</h1>
          <p class="view-desc">药物经济学的数值容错率很低——增量符号、量纲、折现很容易错。用这里的计算器代替手算，结果可以直接用于作业核对。每个计算器和智能体调用的是同一套函数。</p>
        </div>
        <div class="tool-picker" role="tablist" aria-label="选择计算器">
          ${names.map((n, i) => `
            <button class="tool-tab" role="tab" data-tool="${n}" aria-selected="${i === 0}" type="button">
              <span class="tool-tab__name">${MD.esc(FORMS[n].name)}</span>
              <span class="tool-tab__desc">${MD.esc(FORMS[n].desc)}</span>
            </button>`).join('')}
        </div>
        <div id="calcPanel"></div>
      </div>`);

    const panel = wrap.querySelector('#calcPanel');
    let current = names[0];

    /**
     * 取某个字段的初始值。
     * `group` 字段本身没有 key（它是纯容器），子字段的 key 直接来自顶层参数，
     * 所以这里要把整个 preset 传下去 —— 否则 ICER / INMB / PSA / 单因素敏感性
     * 这四个计算器点「快速填入示例」会毫无反应。
     */
    function resolveFieldValue(f, pre) {
      if (f.type === 'group') return pre;
      return pre[f.key];
    }

    function renderTool(name, preset) {
      const form = FORMS[name];
      const pre = preset || (form.presets && form.presets[0] && form.presets[0].args) || {};
      panel.innerHTML = `
        <div class="calc-grid">
          <div>
            <div class="card card--elevated">
              <div class="card__title">
                <span data-icon="${form.icon || 'calculate'}" aria-hidden="true" style="width:22px;height:22px"></span>
                ${MD.esc(form.name)}
              </div>
              <div id="formBody">${form.fields.map((f) =>
                global.FormKit.fieldHTML(f, resolveFieldValue(f, pre))
              ).join('')}</div>
              ${form.presets && form.presets.length ? `
                <div class="view-toolbar" style="margin-top:var(--sp-2)">
                  <span class="field__label" style="margin:0">快速填入示例：</span>
                  ${form.presets.map((p, i) => `<button class="btn btn--outlined btn--sm" data-preset="${i}" type="button">${MD.esc(p.label || `示例 ${i + 1}`)}</button>`).join('')}
                </div>` : ''}
              <div id="formErrors"></div>
              <button class="btn btn--primary btn--lg btn--block" id="calcRun" type="button" style="margin-top:var(--sp-4)">
                <span data-icon="calculate" aria-hidden="true"></span>
                <span class="btn__label">开始计算</span>
              </button>
            </div>
          </div>
          <div>
            <div id="calcResult" class="card card--outlined">
              <div class="empty">
                <div data-icon="calculate" class="empty__icon" aria-hidden="true"></div>
                <div class="empty__title">还没有计算结果</div>
                <p class="empty__desc">左边填好数字，点「开始计算」。填错了软件会明确告诉你是哪一项、应该怎么填。</p>
              </div>
            </div>
          </div>
        </div>`;
      ICON.hydrate(panel);
      bindTool(name);
    }

    function bindTool(name) {
      const form = FORMS[name];
      panel.querySelectorAll('[data-preset]').forEach((b) => {
        b.addEventListener('click', () => {
          const p = form.presets[Number(b.getAttribute('data-preset'))];
          renderTool(name, p.args);
        });
      });

      // 增删行
      panel.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-add-row]');
        if (addBtn) {
          const key = addBtn.getAttribute('data-add-row');
          const box = panel.querySelector(`[data-rows="${key}"]`);
          const f = form.fields.find((x) => x.key === key);
          if (f) {
            const idx = box.querySelectorAll(':scope > [data-row]').length;
            const tmp = document.createElement('div');
            tmp.innerHTML = f.type === 'nested'
              ? nestedRowHTML(f, {})
              : rowsHTMLPublic(f, global.FormKit.blankRow(f.columns), idx);
            ICON.hydrate(tmp);
            box.appendChild(tmp.firstElementChild);
            bindRowEvents();
          }
          return;
        }
        const delBtn = e.target.closest('[data-del-row]');
        if (delBtn) {
          const card = delBtn.closest('[data-row]');
          const box = card.parentElement;
          if (box.querySelectorAll(':scope > [data-row]').length > 1) card.remove();
        }
        const addSub = e.target.closest('[data-add-subrow]');
        if (addSub) {
          const subBox = addSub.previousElementSibling;
          if (subBox) {
            const f = form.fields.find((x) => x.key === 'strategies');
            const col = f.columns.find((c) => c.type === 'subrows');
            const idx = subBox.querySelectorAll('.field-row').length;
            const tmp = document.createElement('div');
            tmp.innerHTML = `<div class="field-row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)">
              ${col.columns.map((c) => subInputPublic(c)).join('')}
              <button type="button" class="icon-btn" data-del-subrow aria-label="删除这个结局"><span data-icon="close"></span></button>
            </div>`;
            ICON.hydrate(tmp);
            subBox.appendChild(tmp.firstElementChild);
          }
          return;
        }
        const delSub = e.target.closest('[data-del-subrow]');
        if (delSub) {
          const fr = delSub.closest('.field-row');
          const box = fr.parentElement;
          if (box.querySelectorAll('.field-row').length > 1) fr.remove();
        }
      });

      const run = panel.querySelector('#calcRun');
      if (run) run.addEventListener('click', () => execute(name));
    }

    function bindRowEvents() { /* 事件已在父级委托 */ }

    // 供增行使用（与 forms.js 内部保持一致）
    function rowsHTMLPublic(f, row, index) {
      return `<div class="card card--outlined" data-row="${index}" style="margin-bottom:var(--sp-3)">
        <div style="display:flex;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-2)">
          <span class="entry__badge">第 ${index + 1} 项</span>
          <div style="flex:1"></div>
          <button type="button" class="icon-btn" data-del-row aria-label="删除这一项" title="删除这一项"><span data-icon="trash"></span></button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:flex-end">
          ${f.columns.map((c) => (c.type === 'subrows' ? '' : inputPublic(c))).join('')}
        </div>
      </div>`;
    }
    function nestedRowHTML(f, row) {
      return rowsHTMLPublic(f, row, 0);
    }
    function inputPublic(c) {
      const attrs = `data-col="${c.key}" class="input" ${c.type === 'number' ? `type="number" inputmode="decimal" step="${c.step || 1}"` : 'type="text"'}`;
      return `<div class="field" style="margin:0;flex:${c.width || 1};min-width:130px">
        <label class="field__label">${MD.esc(c.label)}</label>
        ${c.suffix ? `<div class="input-group"><input ${attrs} /><span class="input-group__suffix">${MD.esc(c.suffix)}</span></div>` : `<input ${attrs} />`}
      </div>`;
    }
    function subInputPublic(c) {
      const attrs = `data-subcol="${c.key}" class="input" ${c.type === 'number' ? `type="number" inputmode="decimal" step="${c.step || 1}"` : 'type="text"'}`;
      return `<div class="field" style="margin:0;flex:1;min-width:110px">
        <label class="field__label">${MD.esc(c.label)}</label>
        ${c.suffix ? `<div class="input-group"><input ${attrs} /><span class="input-group__suffix">${MD.esc(c.suffix)}</span></div>` : `<input ${attrs} />`}
      </div>`;
    }

    async function execute(name) {
      const formBox = panel.querySelector('#formBody');
      const errBox = panel.querySelector('#formErrors');
      const out = panel.querySelector('#calcResult');
      const args = global.FormKit.readArgs(formBox, name);
      const errs = global.FormKit.validate(args, name);

      if (errs.length) {
        errBox.innerHTML = `<div class="notice notice--error" style="margin-top:var(--sp-4)">
          <span data-icon="warning"></span>
          <div class="notice__body"><span class="notice__title">还不能计算，有 ${errs.length} 处需要修改：</span>
          <ul style="margin:8px 0 0">${errs.map((x) => `<li>${MD.esc(x)}</li>`).join('')}</ul></div></div>`;
        ICON.hydrate(errBox);
        errBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      errBox.innerHTML = '';

      const runBtn = panel.querySelector('#calcRun');
      runBtn.setAttribute('data-busy', 'true');
      out.innerHTML = `<div class="notice notice--info"><span class="spinner"></span><div class="notice__body">正在计算…</div></div>`;

      try {
        const res = await api.callTool(name, args);
        out.innerHTML = renderResult(name, res);
        ICON.hydrate(out);
        out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        out.innerHTML = `<div class="result-card result-card--error">
          <div class="result-card__headline">计算没能完成</div>
          <p>${MD.render(err.message)}</p></div>`;
      } finally {
        runBtn.removeAttribute('data-busy');
      }
    }

    wrap.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        wrap.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        current = b.getAttribute('data-tool');
        renderTool(current);
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    renderTool(current);
    return wrap;
  }

  /** 把工具返回的 meta.fields 渲染成结果卡片 */
  function renderResult(name, res) {
    const meta = res.meta || {};
    const rows = Array.isArray(meta.rows) ? meta.rows : [];
    const table = rows.length
      ? `<table class="mini-table">
           <thead><tr>${Object.keys(rows[0]).map((k) => `<th>${MD.esc(k)}</th>`).join('')}</tr></thead>
           <tbody>${rows.map((r) => `<tr>${Object.keys(r).map((k) => `<td>${MD.esc(String(r[k] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
         </table>`
      : '';

    let headline = '计算结果';
    let tone = 'result-card';
    if (!res.success) {
      tone = 'result-card result-card--error';
    } else if (meta.headline) {
      // 工具给出的权威结论优先（如被支配方案必须显示"不应采用"）
      headline = meta.headline;
      if (meta.costEffective === false) tone = 'result-card result-card--error';
      else if (meta.costEffective === null) tone = 'result-card result-card--warn';
    } else if (meta.kind === 'icer' && meta.icer && meta.threshold) {
      headline = meta.icer <= meta.threshold ? '结论：新方案具有成本效果' : '结论：按此阈值，新方案不具成本效果';
      if (meta.icer > meta.threshold) tone = 'result-card result-card--warn';
    } else if (meta.kind === 'psa') {
      headline = `结论：可接受概率 ${(meta.probCE * 100).toFixed(1)}%`;
      if (meta.probCE >= 0.8) tone = 'result-card';
      else if (meta.probCE >= 0.5) tone = 'result-card result-card--warn';
      else tone = 'result-card result-card--error';
    } else if (meta.kind === 'bia') {
      headline = meta.result && meta.result.netAnnualImpact > 0 ? '结论：需要增加预算' : '结论：可节省预算';
    } else if (meta.kind === 'inmb') {
      headline = meta.inmb > 0 ? '结论：INMB 为正，新方案更值得采用' : '结论：INMB 为负，新方案不值得采用';
      if (meta.inmb <= 0) tone = 'result-card result-card--warn';
    }

    // CEAC 曲线
    let chart = '';
    if (meta.ceac && meta.ceac.curve) {
      chart = renderCEAC(meta.ceac, meta.cept);
    }

    // 成本效果平面散点提示
    let plane = '';
    if (meta.plane) {
      plane = `<div class="result-card__formula">成本效果平面：<b>${MD.esc(meta.plane.quadrant)}</b>　Δ成本 = ${MD.esc(meta.plane.deltaCost.toFixed(2))}　Δ效果 = ${MD.esc(meta.plane.deltaEffect.toFixed(4))}</div>`;
    }

    // 教学提示（来自示例库）
    let teach = '';
    const ex = (global.EXAMPLES || []).find((e) => e.tool === name);
    if (ex) teach = `<div class="notice notice--primary" style="margin-top:var(--sp-4)"><span data-icon="lightbulb"></span><div class="notice__body"><span class="notice__title">怎么理解这个结果</span>${MD.render(ex.teachingNote)}</div></div>`;

    return `
      <div class="${tone}">
        <div class="result-card__headline">${MD.esc(headline)}</div>
        <div style="font-family:var(--font-mono);white-space:pre-wrap;line-height:1.75">${MD.esc(res.content)}</div>
        ${plane}
        ${chart}
      </div>
      ${table ? `<div class="card" style="margin-top:var(--sp-4)"><div class="card__title">明细数据</div>${table}</div>` : ''}
      ${teach}
      <div class="view-toolbar">
        <button class="btn btn--outlined btn--sm" data-copy type="button"><span data-icon="copy"></span><span class="btn__label">复制结果</span></button>
        <button class="btn btn--outlined btn--sm" data-export type="button"><span data-icon="download"></span><span class="btn__label">导出报告</span></button>
      </div>`;
  }

  /** 用内联 SVG 画 CEAC 曲线，避免引入图表库 */
  function renderCEAC(ceac, cept) {
    const pts = ceac.curve;
    const W = 600, H = 220, PL = 46, PR = 14, PT = 14, PB = 34;
    const iw = W - PL - PR, ih = H - PT - PB;
    const xmax = ceac.lambdaMax || 1;
    const X = (l) => PL + (l / xmax) * iw;
    const Y = (p) => PT + (1 - p) * ih;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.lambda).toFixed(1)},${Y(p.probCE).toFixed(1)}`).join(' ');
    const area = `${line} L${X(xmax).toFixed(1)},${Y(0).toFixed(1)} L${PL},${Y(0).toFixed(1)} Z`;

    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((g) => `<line class="chart__grid" x1="${PL}" y1="${Y(g)}" x2="${W - PR}" y2="${Y(g)}"/>
                   <text class="chart__label" x="${PL - 6}" y="${Y(g) + 4}" text-anchor="end">${(g * 100).toFixed(0)}%</text>`)
      .join('');
    const xlabels = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => {
        const l = xmax * t;
        return `<text class="chart__label" x="${X(l)}" y="${H - 12}" text-anchor="middle">${fmtShort(l)}</text>`;
      })
      .join('');

    const ceptLine = cept && cept <= xmax
      ? `<line class="chart__axis" x1="${X(cept)}" y1="${PT}" x2="${X(cept)}" y2="${PT + ih}" stroke-dasharray="5 4"/>
         <text class="chart__label" x="${X(cept) + 5}" y="${PT + 14}">CEPT ${fmtShort(cept)}</text>`
      : '';

    return `
      <div class="result-card__formula" style="padding:var(--sp-3)">
        <div style="font-family:var(--font-sans);font-weight:600;margin-bottom:var(--sp-2)">成本效果可接受曲线（CEAC）</div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="成本效果可接受曲线">
          ${grid}
          <path class="chart__area" d="${area}"/>
          <path class="chart__line" d="${line}"/>
          <line class="chart__axis" x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT + ih}"/>
          <line class="chart__axis" x1="${PL}" y1="${PT + ih}" x2="${W - PR}" y2="${PT + ih}"/>
          ${ceptLine}
          ${xlabels}
          <text class="chart__label" x="${W / 2}" y="${H - 1}" text-anchor="middle">阈值 λ（元 / QALY）</text>
        </svg>
        <div style="font-family:var(--font-sans);font-size:var(--type-body-small);opacity:0.85;margin-top:var(--sp-2)">
          横轴是决策者愿意为一个 QALY 付多少钱；纵轴是这个阈值下"新方案更好"的模拟比例。
          曲线与 50% 线的交点就是可接受阈值 CEPT = ${cept ? fmtShort(cept) + ' 元/QALY' : '（在当前区间内未达到 50%）'}。
        </div>
      </div>`;
  }

  function fmtShort(v) {
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(1) + ' 亿';
    if (a >= 1e4) return Math.round(v / 1e4) + ' 万';
    return Math.round(v).toLocaleString('zh-CN');
  }

  /* ============ 知识库浏览 ============ */

  function libraryView(api) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">知识库</h1>
        <p class="view-desc">内置 ${''}条药物经济学条目，内容综合自公开教材、方法学指南、期刊文献与维基百科。每条都标注了出处，方便你回溯原始文献。</p>
      </div>
      <div class="view-toolbar" style="margin-bottom:var(--sp-5)">
        <div style="flex:1;min-width:260px">
          <label class="field__label" for="kbSearch">在知识库里查找</label>
          <input id="kbSearch" class="input" type="search" placeholder="例如：ICER、PSA、折现率、CHEERS" />
        </div>
        <button class="btn btn--outlined" id="kbClear" type="button">清空筛选</button>
      </div>
      <div id="kbBody"><div class="empty"><div class="empty__title">正在载入…</div></div></div>
    </div></div>`);

    const body = wrap.querySelector('#kbBody');
    let activeTopic = null;

    async function loadTopic(id) {
      activeTopic = id;
      body.innerHTML = '<div class="empty"><div class="empty__title">正在载入…</div></div>';
      const entries = await api.getTopic(id);
      const { topics } = await api.browseKB();
      const t = topics.find((x) => x.id === id);
      body.innerHTML = `
        <div class="view-head" style="margin-top:var(--sp-5)">
          <h2 class="view-title">${MD.esc(t.name)}</h2>
          <p class="view-desc">${MD.esc(t.summary || '')}</p>
        </div>
        <div class="entry-list">
          ${entries.map((e) => `
            <div class="entry">
              <div class="entry__head">
                <div class="entry__title">${MD.esc(e.title)}</div>
                <span class="entry__badge">${e.level === 'beginner' ? '入门' : e.level === 'intermediate' ? '进阶' : '高级'}</span>
              </div>
              <div class="entry__body" data-entries>${MD.render(e.summary || '')}…</div>
              <div class="entry__meta">
                <button class="btn btn--text btn--sm" data-open="${e.id}" type="button">展开全文</button>
              </div>
            </div>`).join('')}
        </div>`;
      ICON.hydrate(body);
    }

    async function showTopics() {
      activeTopic = null;
      const { topics } = await api.browseKB();
      body.innerHTML = `
        <div class="topic-grid">
          ${topics.map((t) => `
            <button class="topic-card" data-topic="${t.id}" type="button">
              <div class="topic-card__head">
                <div class="topic-card__icon"><span data-icon="${t.icon || 'library'}"></span></div>
                <div>
                  <div class="topic-card__name">${MD.esc(t.name)}</div>
                  <div class="topic-card__count">${t.count ?? ''}</div>
                </div>
              </div>
              <div class="topic-card__summary">${MD.esc(t.summary || '')}</div>
            </button>`).join('')}
        </div>`;
      ICON.hydrate(body);
    }

    wrap.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-topic]');
      if (t) { await loadTopic(t.getAttribute('data-topic')); body.scrollIntoView({ behavior: 'smooth' }); return; }
      const o = e.target.closest('[data-open]');
      if (o) {
        const entry = await api.getEntry(o.getAttribute('data-open'));
        const box = o.closest('.entry');
        let full = box.querySelector('[data-full]');
        if (full) { full.remove(); o.textContent = '展开全文'; return; }
        full = el(`<div data-full style="margin-top:var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--md-outline-variant)">
          ${MD.render(entry.content)}
          ${entry.source || entry.url ? `<div class="entry__meta">
            ${entry.source ? `<span>📎 来源：${MD.esc(entry.source)}</span>` : ''}
            ${entry.year ? `<span>年份：${MD.esc(entry.year)}</span>` : ''}
          </div>` : ''}
          ${entry.url ? `<button class="btn btn--text btn--sm" data-url="${MD.esc(entry.url)}" type="button"><span data-icon="link"></span><span class="btn__label">打开原始出处</span></button>` : ''}
        </div>`);
        ICON.hydrate(full);
        box.appendChild(full);
        o.textContent = '收起';
      }
      const u = e.target.closest('[data-url]');
      if (u) api.openExternal(u.getAttribute('data-url'));
    });

    wrap.querySelector('#kbClear').addEventListener('click', () => {
      wrap.querySelector('#kbSearch').value = '';
      showTopics();
    });

    let timer;
    wrap.querySelector('#kbSearch').addEventListener('input', (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (!q) { showTopics(); return; }
      timer = setTimeout(async () => {
        const hits = await api.searchKB(q, null, 20);
        body.innerHTML = hits.length
          ? `<div class="entry-list">${hits.map((h) => `
              <div class="entry">
                <div class="entry__head">
                  <div class="entry__title">${MD.esc(h.title)}</div>
                  <span class="entry__badge">${MD.esc(h.topicName || h.topic)} · 相关度 ${h.score.toFixed(2)}</span>
                </div>
                <div class="entry__body">${MD.render(String(h.content).slice(0, 260))}…</div>
                <div class="entry__meta">
                  <button class="btn btn--text btn--sm" data-open="${h.id}" type="button">展开全文</button>
                  ${h.source ? `<span>📎 ${MD.esc(h.source)}</span>` : ''}
                </div>
              </div>`).join('')}</div>`
          : `<div class="empty"><div class="empty__title">没找到「${MD.esc(q)}」</div><p class="empty__desc">换个更常见的说法试试，比如把缩写展开成全称。</p></div>`;
        ICON.hydrate(body);
      }, 220);
    });

    showTopics();
    return wrap;
  }

  /* ============ 术语表 ============ */

  function glossaryView(api) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">术语表</h1>
        <p class="view-desc">药物经济学的缩写很多。先弄懂这几个，看到英文文献就不怕了。点任意一张卡片看详细解释。</p>
      </div>
      <div class="view-toolbar" style="margin-bottom:var(--sp-5)">
        <div style="flex:1;min-width:260px">
          <label class="field__label" for="gSearch">按缩写、中文或英文查找</label>
          <input id="gSearch" class="input" type="search" placeholder="例如：ICER、QALY、阈值" />
        </div>
      </div>
      <div class="term-grid" id="gBody"></div>
    </div></div>`);

    const body = wrap.querySelector('#gBody');
    let all = [];

    function paint(list) {
      body.innerHTML = list.length
        ? list.map((g) => `
            <button class="term-card" data-term="${MD.esc(g.term)}" type="button">
              <span class="term-card__abbr">${MD.esc(g.term)}</span>
              <span class="term-card__en">${MD.esc(g.en || '')}</span>
              <span class="term-card__cn">${MD.esc(g.abbr || '')}</span>
              <span class="term-card__def">${MD.esc(String(g.definition).slice(0, 110))}…</span>
            </button>`).join('')
        : '<div class="empty"><div class="empty__title">没有匹配的术语</div></div>';
      ICON.hydrate(body);
    }

    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-term]');
      if (!c) return;
      const g = all.find((x) => x.term === c.getAttribute('data-term'));
      showModal({
        title: `${g.term}${g.en ? ' · ' + g.en : ''}`,
        body: `
          <p style="font:600 var(--type-title-medium);margin-bottom:var(--sp-3)">${MD.esc(g.abbr || '')}</p>
          <p>${MD.render(g.definition)}</p>
          ${g.formula ? `<div class="formula-card" style="margin:var(--sp-4) 0"><div class="formula-card__expr">${MD.esc(g.formula)}</div></div>` : ''}
          ${g.notes ? `<div class="notice notice--warning" style="margin-top:var(--sp-4)"><span data-icon="warning"></span><div class="notice__body"><span class="notice__title">注意</span>${MD.render(g.notes)}</div></div>` : ''}
          ${g.source ? `<p class="entry__meta" style="margin-top:var(--sp-4)">📎 出处：${MD.esc(g.source)}</p>` : ''}`,
      });
    });

    wrap.querySelector('#gSearch').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return paint(all);
      paint(all.filter((g) =>
        g.term.toLowerCase().includes(q) ||
        (g.abbr || '').toLowerCase().includes(q) ||
        (g.en || '').toLowerCase().includes(q) ||
        String(g.definition).toLowerCase().includes(q)
      ));
    });

    api.browseKB().then((b) => { all = b.glossary; paint(all); });
    return wrap;
  }

  /* ============ 公式速查 ============ */

  function formulasView(api) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">公式速查</h1>
        <p class="view-desc">药物经济学常用公式。每个都配了算例和单位说明，可以直接抄进作业（记得注明出处）。</p>
      </div>
      <div id="fBody" style="display:flex;flex-direction:column;gap:var(--sp-4)"></div>
    </div></div>`);
    const body = wrap.querySelector('#fBody');
    api.browseKB().then((b) => {
      body.innerHTML = b.formulas.map((f) => `
        <div class="formula-card">
          <div class="card__title" style="margin:0">${MD.esc(f.name)}</div>
          <div class="formula-card__expr">${MD.esc(f.expr)}</div>
          <p style="margin-bottom:var(--sp-2)">${MD.render(f.desc)}</p>
          <div class="entry__meta">
            <span>单位：${MD.esc(f.unit)}</span>
          </div>
          <div class="notice notice--info" style="margin-top:var(--sp-3)">
            <span data-icon="lightbulb"></span>
            <div class="notice__body"><span class="notice__title">算例</span>${MD.render(f.example)}</div>
          </div>
        </div>`).join('');
      ICON.hydrate(body);
    });
    return wrap;
  }

  /* ============ 学习路径 ============ */

  function pathView(api, onAsk) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">学习路径</h1>
        <p class="view-desc">如果完全没接触过药物经济学，按这个顺序走一遍。每一步都有明确的"学什么"和"做什么"，做完打勾。进度会自动保存。</p>
      </div>
      <div class="view-toolbar" style="margin-bottom:var(--sp-5)">
        <button class="btn btn--outlined" id="resetPath" type="button"><span data-icon="refresh"></span><span class="btn__label">清空学习进度</span></button>
        <span id="pathStat" class="field__label" style="margin:0"></span>
      </div>
      <div id="pBody" style="display:flex;flex-direction:column;gap:var(--sp-3)"></div>
    </div></div>`);

    const body = wrap.querySelector('#pBody');
    const KEY = 'pe.path.progress';
    let done = {};
    try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { done = {}; }

    function save() { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch { /* 忽略 */ } }
    function refresh() {
      const steps = wrap.__steps || [];
      const n = steps.filter((s) => done[s.step]).length;
      wrap.querySelector('#pathStat').textContent = `已完成 ${n} / ${steps.length} 步`;
    }

    function paint(steps) {
      wrap.__steps = steps;
      body.innerHTML = steps.map((s) => `
        <div class="path-item ${done[s.step] ? 'is-done' : ''}" data-step="${s.step}">
          <div class="path-item__num">${done[s.step] ? '✓' : s.step}</div>
          <div style="flex:1;min-width:0">
            <div class="path-item__title">${MD.esc(s.title)}</div>
            <div class="path-item__meta">⏱ 约 ${s.minutes} 分钟　·　目标：${MD.esc(s.goal)}</div>
            <div class="path-item__task"><b>动手做：</b>${MD.render(s.task)}</div>
            <div class="path-item__task" style="background:var(--md-surface-container-low)"><b>检验是否学会：</b>${MD.render(s.check)}</div>
            <div class="path-item__actions">
              <button class="btn ${done[s.step] ? 'btn--outlined' : 'btn--tonal'} btn--sm" data-toggle type="button">
                <span data-icon="check"></span><span class="btn__label">${done[s.step] ? '已学会（点击取消）' : '标记为已学会'}</span>
              </button>
              <button class="btn btn--text btn--sm" data-ask="${MD.esc(s.title)}" type="button">
                <span data-icon="chat"></span><span class="btn__label">问智能体</span>
              </button>
            </div>
          </div>
        </div>`).join('');
      ICON.hydrate(body);
      refresh();
    }

    body.addEventListener('click', (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const step = Number(tg.closest('[data-step]').getAttribute('data-step'));
        if (done[step]) delete done[step]; else done[step] = Date.now();
        save();
        paint(wrap.__steps);
        return;
      }
      const a = e.target.closest('[data-ask]');
      if (a) onAsk(`关于「${a.getAttribute('data-ask')}」，请用大白话给我讲清楚，并给一个具体例子。`);
    });

    wrap.querySelector('#resetPath').addEventListener('click', () => {
      done = {}; save(); paint(wrap.__steps);
      toast('学习进度已清空');
    });

    api.browseKB().then((b) => paint(b.learningPath || []));
    return wrap;
  }

  /* ============ 自检清单 ============ */

  function checklistView(api) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">自检清单</h1>
        <p class="view-desc">写报告或作业前逐条对照。特别注意 CHEERS 2022 的边界——它是「报告质量」清单，不是给文章打分的工具。</p>
      </div>
      <div class="tool-picker" id="clPicker" role="tablist" aria-label="选择清单"></div>
      <div id="clBody"></div>
    </div></div>`);
    const picker = wrap.querySelector('#clPicker');
    const body = wrap.querySelector('#clBody');
    let lists = [];
    let current = null;

    function paintList(c) {
      current = c;
      picker.querySelectorAll('[data-cl]').forEach((x) => x.setAttribute('aria-selected', String(x.getAttribute('data-cl') === c.id)));
      const saved = load(c.id);
      body.innerHTML = `
        <div class="card card--elevated">
          <div class="card__title">
            <span data-icon="checklist" style="width:22px;height:22px"></span>${MD.esc(c.name)}
          </div>
          <p style="margin-bottom:var(--sp-3);color:var(--md-on-surface-variant)">${MD.render(c.desc || '')}</p>
          ${c.caution ? `<div class="notice notice--warning" style="margin-bottom:var(--sp-4)"><span data-icon="warning"></span><div class="notice__body"><span class="notice__title">边界提醒</span>${MD.render(c.caution)}</div></div>` : ''}
          <div class="entry-list">
            ${c.items.map((it, i) => {
              const t = typeof it === 'string' ? it : it.text;
              const tag = typeof it === 'string' ? '' : `<span class="entry__badge" style="margin-left:8px">${MD.esc(it.cheers || '')}</span>`;
              return `<label class="check" data-idx="${i}">
                <input type="checkbox" data-check ${saved[i] ? 'checked' : ''} />
                <span class="check__text">${MD.esc(t)}${tag}</span>
              </label>`;
            }).join('')}
          </div>
          <div class="view-toolbar">
            <button class="btn btn--outlined btn--sm" data-reset type="button"><span data-icon="refresh"></span><span class="btn__label">清空勾选</span></button>
            ${c.source ? `<span class="field__label" style="margin:0">来源：${MD.esc(c.source)}</span>` : ''}
          </div>
        </div>`;
      ICON.hydrate(body);
    }

    const load = (id) => { try { return JSON.parse(localStorage.getItem(`pe.cl.${id}`) || '[]'); } catch { return []; } };
    const save = (id, v) => { try { localStorage.setItem(`pe.cl.${id}`, JSON.stringify(v)); } catch { /* 忽略 */ } };

    body.addEventListener('change', (e) => {
      const cb = e.target.closest('[data-check]');
      if (!cb) return;
      const arr = load(current.id);
      arr[Number(cb.getAttribute('data-check'))] = cb.checked;
      save(current.id, arr);
    });
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-reset]')) { save(current.id, []); paintList(current); toast('已清空勾选'); }
    });

    api.browseKB().then((b) => {
      lists = b.checklists;
      picker.innerHTML = lists.map((c, i) => `
        <button class="tool-tab" role="tab" data-cl="${c.id}" aria-selected="${i === 0}" type="button">
          <span class="tool-tab__name">${MD.esc(c.name)}</span>
          <span class="tool-tab__desc">${c.items.length} 项</span>
        </button>`).join('');
      picker.querySelectorAll('[data-cl]').forEach((b) =>
        b.addEventListener('click', () => paintList(lists.find((x) => x.id === b.getAttribute('data-cl'))))
      );
      if (lists.length) paintList(lists[0]);
    });

    return wrap;
  }

  /* ============ 延伸阅读 ============ */

  function resourcesView(api) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">延伸阅读</h1>
        <p class="view-desc">按重要程度排的清单。如果只读一样，读带 ★ 的核心教材；如果只想找规范原文，看 CHEERS 和 NICE PMG36。</p>
      </div>
      <div id="rBody" style="display:flex;flex-direction:column;gap:var(--sp-4)"></div>
    </div></div>`);
    const body = wrap.querySelector('#rBody');
    api.browseKB().then((b) => {
      const order = ['核心教材', '国内指南', '报告规范', '机构方法学', '方法学清单', '国际指南', '框架', '方法学', '在线资源', '在线百科', '国内教材', '学术组织', '政策文件'];
      const items = b.resources.slice().sort((a, c) => {
        const ia = order.indexOf(a.type); const ic = order.indexOf(c.type);
        return (ia < 0 ? 99 : ia) - (ic < 0 ? 99 : ic);
      });
      body.innerHTML = items.map((r) => `
        <div class="entry">
          <div class="entry__head">
            <div class="entry__title">${MD.esc(r.title)}</div>
            <span class="entry__badge">${MD.esc(r.type)}</span>
          </div>
          ${r.authors ? `<div class="entry__body" style="font-size:var(--type-body-small);color:var(--md-on-surface-variant)">${MD.esc(r.authors)}</div>` : ''}
          <div class="entry__body" style="margin-top:var(--sp-2)">${MD.render(r.note || '')}</div>
          ${r.url ? `<div class="entry__meta"><button class="btn btn--text btn--sm" data-url="${MD.esc(r.url)}" type="button"><span data-icon="link"></span><span class="btn__label">在浏览器中打开</span></button></div>` : ''}
        </div>`).join('');
      ICON.hydrate(body);
    });
    wrap.addEventListener('click', (e) => {
      const u = e.target.closest('[data-url]');
      if (u) api.openExternal(u.getAttribute('data-url'));
    });
    return wrap;
  }

  /* ============ 历史记录 ============ */

  function historyView(api, onRestore) {
    const wrap = el(`<div class="view"><div class="view-inner">
      <div class="view-head">
        <h1 class="view-title">历史对话</h1>
        <p class="view-desc">你的每次提问都会保存在本机，不会上传到任何服务器。点任意一条可以继续对话。</p>
      </div>
      <div class="view-toolbar" style="margin-bottom:var(--sp-5)">
        <button class="btn btn--danger" id="clearAll" type="button"><span data-icon="trash"></span><span class="btn__label">清空全部历史</span></button>
        <button class="btn btn--outlined" id="reload" type="button"><span data-icon="refresh"></span><span class="btn__label">刷新列表</span></button>
      </div>
      <div class="entry-list" id="hBody"></div>
    </div></div>`);
    const body = wrap.querySelector('#hBody');

    async function load() {
      const list = await api.listSessions();
      body.innerHTML = list.length
        ? list.map((s) => `
            <div class="entry">
              <div class="entry__head">
                <div class="entry__title">${MD.esc(s.title)}</div>
                <span class="entry__badge">${s.messageCount} 条消息</span>
              </div>
              <div class="entry__meta">
                <span>🕐 ${new Date(s.updatedAt).toLocaleString('zh-CN')}</span>
                <div style="flex:1"></div>
                <button class="btn btn--tonal btn--sm" data-restore="${s.id}" type="button">继续这段对话</button>
                <button class="btn btn--text btn--sm" data-del="${s.id}" type="button"><span data-icon="trash"></span><span class="btn__label">删除</span></button>
              </div>
            </div>`).join('')
        : `<div class="empty"><div class="empty__title">还没有历史记录</div><p class="empty__desc">回到「智能问答」问第一个问题吧。</p></div>`;
      ICON.hydrate(body);
    }

    body.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-restore]');
      if (r) { const s = await api.getSession(r.getAttribute('data-restore')); onRestore(s); return; }
      const d = e.target.closest('[data-del]');
      if (d) { await api.deleteSession(d.getAttribute('data-del')); toast('已删除'); load(); }
    });

    wrap.querySelector('#clearAll').addEventListener('click', async () => {
      if (!confirm('确定要清空全部历史对话吗？此操作无法撤销。')) return;
      await api.clearSessions();
      toast('历史已清空');
      load();
    });
    wrap.querySelector('#reload').addEventListener('click', load);

    load();
    return wrap;
  }

  /* ============ 设置 ============ */

  function settingsView(api, onChanged) {
    const wrap = el(`<div class="view"><div class="view-inner" style="max-width:820px">
      <div class="view-head">
        <h1 class="view-title">设置</h1>
        <p class="view-desc">不填任何东西也能用——软件内置了完整的知识库和全部计算器。填入 API Key 后，智能体会用大模型给你更长、更个性化的讲解。</p>
      </div>
      <div id="sBody"><div class="empty"><div class="empty__title">正在载入…</div></div></div>
    </div></div>`);
    const body = wrap.querySelector('#sBody');

    const PRESETS = [
      { id: '', label: '离线模式（无需任何配置）', model: '', baseUrl: '' },
      { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
      { id: 'qwen', label: '阿里通义千问（DashScope）', model: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { id: 'kimi', label: '月之暗面 Kimi', model: 'moonshot-v1-8k', baseUrl: 'https://api.moonshot.cn/v1' },
      { id: 'glm', label: '智谱 GLM', model: 'glm-4-flash', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
      { id: 'siliconflow', label: '硅基流动 SiliconFlow', model: 'Qwen/Qwen2.5-7B-Instruct', baseUrl: 'https://api.siliconflow.cn/v1' },
      { id: 'ollama', label: '本机 Ollama（完全本地，不联网）', model: 'qwen2.5:7b', baseUrl: 'http://localhost:11434/v1' },
      { id: 'custom', label: '自定义（OpenAI 兼容接口）', model: '', baseUrl: '' },
    ];

    api.getSettings().then((s) => {
      const curId =
        s.isOffline ? '' :
        PRESETS.find((p) => p.baseUrl && s.baseUrl.startsWith(p.baseUrl.replace('/compatible-mode/v1', '')))?.id || 'custom';

      body.innerHTML = `
        <div class="card card--elevated">
          <div class="card__title"><span data-icon="settings" style="width:22px;height:22px"></span>运行模式</div>
          <div class="notice notice--success" style="margin-bottom:var(--sp-5)">
            <span data-icon="check"></span>
            <div class="notice__body">
              <span class="notice__title">当前：${s.isOffline ? '离线知识模式（推荐先用这个）' : 'AI 深度问答模式'}</span>
              ${s.isOffline
                ? '问答、计算器、知识库、学习路径、自检清单<b>全部可用</b>。回答来自内置知识库，每条都标注了出处。填入 API Key 可以获得更自然的讲解和更灵活的多轮问答。'
                : `模型：<b>${MD.esc(s.model)}</b>　服务：${MD.esc(s.baseUrl)}`}
            </div>
          </div>

          <div class="field">
            <label class="field__label" for="providerSel">选择服务商</label>
            <select id="providerSel" class="select">
              ${PRESETS.map((p) => `<option value="${p.id}" ${p.id === curId ? 'selected' : ''}>${MD.esc(p.label)}</option>`).join('')}
            </select>
            <div class="field__hint">任何"OpenAI 兼容"的服务都能用。不想联网可以选最后一项「本机 Ollama」。</div>
          </div>

          <div id="apiFields">
            <div class="field">
              <label class="field__label" for="baseUrlInput">接口地址</label>
              <input id="baseUrlInput" class="input" type="text" value="${MD.esc(s.baseUrl)}" placeholder="https://api.deepseek.com/v1" />
            </div>
            <div class="field">
              <label class="field__label" for="modelInput">模型名称</label>
              <input id="modelInput" class="input" type="text" value="${MD.esc(s.model)}" placeholder="deepseek-chat" />
              <div class="field__hint">填错模型名会报错。常见报错信息是"model not found"，那就是这里填错了。</div>
            </div>
            <div class="field">
              <label class="field__label" for="keyInput">API Key</label>
              <input id="keyInput" class="input" type="password" placeholder="${s.hasKey ? '已保存：' + MD.esc(s.keyPreview) : '粘贴你的 API Key'}" />
              <div class="field__hint">Key 只保存在<b>你自己电脑</b>上，不会上传到任何地方。留空表示不修改已保存的 Key。</div>
            </div>
          </div>

          <div class="view-toolbar">
            <button class="btn btn--primary btn--lg" id="saveBtn" type="button"><span data-icon="check"></span><span class="btn__label">保存设置</span></button>
            <button class="btn btn--outlined" id="toOffline" type="button"><span data-icon="refresh"></span><span class="btn__label">切回离线模式</span></button>
          </div>
        </div>

        <div class="card" style="margin-top:var(--sp-5)">
          <div class="card__title"><span data-icon="folder" style="width:22px;height:22px"></span>文件与数据</div>
          <p style="margin-bottom:var(--sp-3)">导出的报告默认保存在 exe 旁边的「我的报告」文件夹里。</p>
          <div class="view-toolbar">
            <button class="btn btn--outlined" id="openReports" type="button"><span data-icon="folder"></span><span class="btn__label">打开我的报告文件夹</span></button>
          </div>
        </div>

        <div class="card" style="margin-top:var(--sp-5)">
          <div class="card__title"><span data-icon="checklist" style="width:22px;height:22px"></span>运行自检</div>
          <p style="margin-bottom:var(--sp-3)">如果软件用起来不对劲，点这里检查一遍。结果会同时保存到日志文件，可以直接把日志发给别人帮忙排查。</p>
          <div class="view-toolbar">
            <button class="btn btn--tonal" id="runDiag" type="button"><span data-icon="refresh"></span><span class="btn__label">开始自检</span></button>
            <button class="btn btn--text" id="openLog" type="button"><span data-icon="folder"></span><span class="btn__label">打开日志文件夹</span></button>
          </div>
          <div id="diagBox" style="margin-top:var(--sp-4)"></div>
        </div>

        <div class="card" style="margin-top:var(--sp-5)">
          <div class="card__title"><span data-icon="info" style="width:22px;height:22px"></span>关于</div>
          <div class="entry-list" id="aboutBox"></div>
        </div>`;
      ICON.hydrate(body);

      const sel = body.querySelector('#providerSel');
      const apiFields = body.querySelector('#apiFields');
      function syncProvider() {
        const p = PRESETS.find((x) => x.id === sel.value);
        const offline = !sel.value;
        apiFields.style.display = offline ? 'none' : '';
        if (p && p.id !== 'custom') {
          if (p.model) body.querySelector('#modelInput').value = p.model;
          if (p.baseUrl) body.querySelector('#baseUrlInput').value = p.baseUrl;
        }
      }
      sel.addEventListener('change', syncProvider);
      syncProvider();

      body.querySelector('#saveBtn').addEventListener('click', async () => {
        const btn = body.querySelector('#saveBtn');
        btn.setAttribute('data-busy', 'true');
        try {
          const payload = sel.value === ''
            ? { provider: 'offline' }
            : {
                baseUrl: body.querySelector('#baseUrlInput').value.trim(),
                model: body.querySelector('#modelInput').value.trim(),
                apiKey: body.querySelector('#keyInput').value.trim() || undefined,
                provider: 'auto',
              };
          const r = await api.saveSettings(payload);
          toast(r.provider === 'offline' ? '已切换到离线模式' : '设置已保存');
          onChanged(r);
          settingsView(api, onChanged);
          const nb = body.querySelector('#aboutBox');
          if (nb) nb.innerHTML = '';
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          btn.removeAttribute('data-busy');
        }
      });

      body.querySelector('#toOffline').addEventListener('click', async () => {
        await api.resetSettings();
        toast('已切回离线模式');
        onChanged({ provider: 'offline' });
        settingsView(api, onChanged);
      });

      body.querySelector('#openReports').addEventListener('click', () => api.openReportFolder());

      // ---- 一键自检 ----
      body.querySelector('#openLog').addEventListener('click', () => api.openReportFolder());
      body.querySelector('#runDiag').addEventListener('click', async () => {
        const btn = body.querySelector('#runDiag');
        const box = body.querySelector('#diagBox');
        btn.setAttribute('data-busy', 'true');
        box.innerHTML = '<div class="notice notice--info"><span class="spinner"></span><div class="notice__body">正在检查…</div></div>';
        ICON.hydrate(box);
        try {
          const r = await api.runDiag();
          const failed = r.items.filter((i) => !i.pass);
          box.innerHTML = `
            <div class="notice notice--${failed.length ? 'warning' : 'success'}">
              <span data-icon="${failed.length ? 'warning' : 'check'}"></span>
              <div class="notice__body">
                <span class="notice__title">${failed.length ? `${r.failed} 项需要留意` : `全部通过：${r.passed} 项`}</span>
                ${failed.length ? '下面是结果明细。带 ⚠ 的项目需要留意，其余功能正常。' : '软件各部分工作正常。'}
              </div>
            </div>
            <table class="mini-table" style="margin-top:var(--sp-3)">
              <thead><tr><th>检查项</th><th>结果</th><th>说明</th></tr></thead>
              <tbody>${r.items.map((i) => `<tr>
                <td>${MD.esc(i.name)}</td>
                <td>${i.pass ? '通过' : '未通过'}</td>
                <td style="font-size:var(--type-body-small);color:var(--md-on-surface-variant)">${MD.esc(i.detail)}</td>
              </tr>`).join('')}</tbody>
            </table>
            <p style="font:var(--type-body-small);color:var(--md-on-surface-variant);margin-top:var(--sp-2)">
              检查时间：${new Date(r.at).toLocaleString('zh-CN')}　·　日志已保存，可点上方「打开日志文件夹」取得。</p>`;
          ICON.hydrate(box);
        } catch (err) {
          box.innerHTML = `<div class="notice notice--error"><span data-icon="warning"></span>
            <div class="notice__body"><span class="notice__title">自检没能完成</span>${MD.render(err.message)}</div></div>`;
          ICON.hydrate(box);
        } finally {
          btn.removeAttribute('data-busy');
        }
      });

      api.getAppInfo().then((info) => {
        const b = body.querySelector('#aboutBox');
        if (!b) return;
        b.innerHTML = `
          <div class="entry__meta" style="display:grid;grid-template-columns:auto 1fr;gap:var(--sp-2) var(--sp-4)">
            <span>软件版本</span><span>${MD.esc(info.version)}</span>
            <span>知识库来源</span><span>${MD.esc(info.kbSource || '未加载')}</span>
            <span>知识库规模</span><span>${info.kbStats.chunks} 条目 · ${info.kbStats.glossary} 术语 · ${info.kbStats.formulas} 公式</span>
            <span>可用工具</span><span>${info.tools.length} 个</span>
            <span>报告文件夹</span><span style="word-break:break-all">${MD.esc(info.reportDir)}</span>
            <span>配置文件夹</span><span style="word-break:break-all">${MD.esc(info.configPath || '—')}</span>
          </div>
          <div class="notice notice--info" style="margin-top:var(--sp-4)">
            <span data-icon="info"></span>
            <div class="notice__body">本软件输出为<b>学习辅助</b>，不构成医疗、用药或医保决策建议。正式研究请以原始指南与文献为准，并遵循 CHEERS 2022 报告规范。</div>
          </div>`;
        ICON.hydrate(b);
      });
    });

    return wrap;
  }

  /* ============ 帮助 ============ */

  function helpView(api) {
    return el(`<div class="view"><div class="view-inner" style="max-width:860px">
      <div class="view-head">
        <h1 class="view-title">怎么用这个软件</h1>
        <p class="view-desc">不需要任何电脑基础，按下面的步骤做就行。</p>
      </div>

      <div class="card card--elevated" style="margin-bottom:var(--sp-4)">
        <div class="card__title"><span data-icon="chat" style="width:22px;height:22px"></span>第一步：问问题</div>
        <ol style="font:var(--type-body-medium);line-height:1.9;padding-left:1.4em">
          <li>在左下角的输入框里，用<b>大白话</b>打字。比如「QALY 是啥」「ICER 怎么算」「为什么要做敏感性分析」。</li>
          <li>按 <b>Enter</b> 发送。按 <b>Shift + Enter</b> 可以换行。</li>
          <li>不知道问什么？直接点回答下方推荐的「问号按钮」，不用打字。</li>
          <li>回答里出现的紫色「思考过程」可以点开，看看软件是<b>怎么算出来的</b>。</li>
        </ol>
        <div class="notice notice--primary" style="margin-top:var(--sp-3)">
          <span data-icon="lightbulb"></span>
          <div class="notice__body"><span class="notice__title">三种回答方式怎么选</span>
            <b>直接回答</b>：适合单个问题，最快。<br/>
            <b>先规划再解答</b>：适合"帮我完整分析一个药"这种多步骤任务，软件会先列计划再逐步做。<br/>
            <b>回答后自查</b>：适合检查作业，软件会再校一遍公式方向、符号和结论是否一致。
          </div>
        </div>
      </div>

      <div class="card card--elevated" style="margin-bottom:var(--sp-4)">
        <div class="card__title"><span data-icon="calculate" style="width:22px;height:22px"></span>第二步：用计算器</div>
        <p style="margin-bottom:var(--sp-3)">药物经济学的数字很容易算错，<b>不要手算</b>。左侧「计算器」里有 9 个工具，填数字、点按钮、出结果。</p>
        <ul style="font:var(--type-body-medium);line-height:1.9;padding-left:1.4em">
          <li>每个输入框都有<b>中文标签和单位</b>，不知道填什么就先看上面的提示条。</li>
          <li>填错了软件会明确告诉你是<b>哪一项、应该怎么填</b>，不会只给一个"错误"。</li>
          <li>结果卡片下方有「<b>怎么理解这个结果</b>」，会讲这道题背后的道理。</li>
          <li>算完可以点「复制结果」或「导出报告」保存下来。</li>
        </ul>
      </div>

      <div class="card card--elevated" style="margin-bottom:var(--sp-4)">
        <div class="card__title"><span data-icon="school" style="width:22px;height:22px"></span>第三步：系统学习</div>
        <p>如果完全没接触过药物经济学，去「<b>学习路径</b>」按顺序走一遍，13 步，每步都有"学什么"和"动手做"，学会一步点一下打勾，进度自动保存。</p>
      </div>

      <div class="card card--elevated" style="margin-bottom:var(--sp-4)">
        <div class="card__title"><span data-icon="checklist" style="width:22px;height:22px"></span>第四步：交作业前自查</div>
        <p>去「<b>自检清单</b>」，用 CHEERS 2022（28 条）或中国指南清单逐条勾一遍。清单里有几处<b>特别容易踩的坑</b>，清单本身有提醒。</p>
      </div>

      <div class="card card--elevated">
        <div class="card__title"><span data-icon="warning" style="width:22px;height:22px"></span>需要知道的限制</div>
        <ul style="font:var(--type-body-medium);line-height:1.9;padding-left:1.4em">
          <li>本软件是<b>学习辅助工具</b>，不构成医疗、用药或医保决策建议。</li>
          <li>知识库里的数字和阈值<b>可能随政策更新而变化</b>。正式引用前请回溯原始出处核对。</li>
          <li>默认不联网。你的提问、历史记录、API Key 都只存在本机，不上传任何服务器。</li>
          <li>计算器用固定随机种子，<b>同样的输入必然得到同样的结果</b>，可以放心反复对照。</li>
        </ul>
      </div>
    </div></div>`);
  }

  /* ============ 弹窗与提示 ============ */

  function showModal({ title, body, actions, onClose }) {
    const root = document.getElementById('modalRoot');
    const scrim = el(`
      <div class="dialog-scrim" role="dialog" aria-modal="true" aria-label="${MD.esc(title)}">
        <div class="dialog">
          <div class="dialog__head">
            <div class="dialog__title">${MD.esc(title)}</div>
            <button class="icon-btn" data-close aria-label="关闭" title="关闭"><span data-icon="close"></span></button>
          </div>
          <div class="dialog__body">${body}</div>
          <div class="dialog__actions">
            ${(actions || [{ label: '知道了' }]).map((a, i) => `<button class="btn ${a.primary ? 'btn--primary' : 'btn--outlined'}" data-action="${i}" type="button">${MD.esc(a.label)}</button>`).join('')}
          </div>
        </div>
      </div>`);
    ICON.hydrate(scrim);

    function close() {
      scrim.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim || e.target.closest('[data-close]')) return close();
      const a = e.target.closest('[data-action]');
      if (a) { const act = (actions || [{}])[Number(a.getAttribute('data-action'))]; close(); if (act && act.onClick) act.onClick(); }
    });
    root.appendChild(scrim);
    const first = scrim.querySelector('.btn');
    if (first) first.focus();
  }

  function toast(message, tone = 'info') {
    const root = document.getElementById('toastRoot');
    const kind = tone === 'error' ? 'error' : tone === 'success' ? 'success' : 'info';
    const t = el(`<div class="notice notice--${kind}" style="box-shadow:0 4px 8px 3px rgb(0 0 0 / .15);max-width:520px">
      <span data-icon="${tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'info'}"></span>
      <div class="notice__body">${MD.render(message)}</div></div>`);
    ICON.hydrate(t);
    root.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, tone === 'error' ? 6000 : 3200);
  }

  global.Views = {
    calculatorView, libraryView, glossaryView, formulasView,
    pathView, checklistView, resourcesView, historyView,
    settingsView, helpView, showModal, toast, renderResult, el,
  };
})(window);
