/**
 * 应用主逻辑
 * ---------------------------------------------------------------
 * 负责：视图路由、对话状态、IPC 接线、主题切换、键盘交互。
 * 渲染进程无 Node 权限，所有能力通过 window.pe（preload 暴露）访问。
 */
(function () {
  'use strict';

  const MD = window.MD;
  const ICON = window.ICON;
  const Views = window.Views;
  const pe = window.pe;

  /* ============ 全局状态 ============ */

  const NAV = [
    { id: 'chat', label: '智能问答', icon: 'chat', title: '智能问答', sub: '用大白话学药物经济学' },
    { id: 'calculator', label: '计算器', icon: 'calculate', title: '计算器', sub: '9 个药物经济学计算工具' },
    { id: 'library', label: '知识库', icon: 'library', title: '知识库', sub: '教材、指南、文献摘录' },
    { id: 'glossary', label: '术语表', icon: 'functions_alt', title: '术语表', sub: '缩写速查' },
    { id: 'formulas', label: '公式', icon: 'functions', title: '公式速查', sub: '公式 + 算例' },
    { id: 'path', label: '学习路径', icon: 'school', title: '学习路径', sub: '从零开始的 13 步' },
    { id: 'checklist', label: '自检清单', icon: 'checklist', title: '自检清单', sub: 'CHEERS 2022 等' },
    { id: 'resources', label: '延伸阅读', icon: 'book', title: '延伸阅读', sub: '书籍与原始文献' },
    { id: 'history', label: '历史记录', icon: 'history', title: '历史对话', sub: '只存在本机' },
  ];

  const state = {
    view: 'chat',
    mode: 'react',
    sessionId: newSessionId(),
    history: [],
    sending: false,
    appInfo: null,
    settings: null,
    examples: [],
  };

  const $ = (s) => document.querySelector(s);
  const content = $('#content');
  const main = $('#main');
  const inputBar = $('#inputBar');
  const askInput = $('#askInput');

  function newSessionId() {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /* ============ 主题 ============ */

  function initTheme() {
    let t = null;
    try { t = localStorage.getItem('pe.theme'); } catch { /* 忽略 */ }
    if (t) document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : sysDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('pe.theme', next); } catch { /* 忽略 */ }
    });
  }

  /* ============ 导航 ============ */

  function buildNav() {
    const box = $('#navItems');
    box.innerHTML = NAV.map((n) => `
      <button class="nav-item" data-view="${n.id}" type="button">
        <span data-icon="${n.icon}" aria-hidden="true"></span>
        <span>${MD.esc(n.label)}</span>
      </button>`).join('');
    ICON.hydrate(box);
    box.querySelectorAll('[data-view]').forEach((b) =>
      b.addEventListener('click', () => go(b.getAttribute('data-view')))
    );
    $('#navItems').parentElement.querySelector('[data-view="settings"]')
      .addEventListener('click', () => go('settings'));
  }

  function markNav(id) {
    document.querySelectorAll('.nav-item').forEach((b) => {
      if (b.getAttribute('data-view') === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function go(id) {
    state.view = id;
    const meta = NAV.find((n) => n.id === id);
    $('#viewTitle').textContent = meta ? meta.title : id === 'settings' ? '设置' : '使用帮助';
    $('#viewSub').textContent = meta ? meta.sub : '';
    markNav(id);

    main.classList.toggle('chat', id === 'chat');
    inputBar.style.display = id === 'chat' ? '' : 'none';
    content.className = id === 'chat' ? 'messages' : 'view';
    content.innerHTML = '';

    let node;
    try {
      switch (id) {
        case 'chat': node = null; break;
        case 'calculator': node = Views.calculatorView(pe, state.examples); break;
        case 'library': node = Views.libraryView(pe); break;
        case 'glossary': node = Views.glossaryView(pe); break;
        case 'formulas': node = Views.formulasView(pe); break;
        case 'path': node = Views.pathView(pe, (q) => { go('chat'); setTimeout(() => send(q), 60); }); break;
        case 'checklist': node = Views.checklistView(pe); break;
        case 'resources': node = Views.resourcesView(pe); break;
        case 'history': node = Views.historyView(pe, restoreSession); break;
        case 'settings': node = Views.settingsView(pe, onSettingsChanged); break;
        default: node = Views.helpView(pe);
      }
    } catch (err) {
      node = Views.el(`<div class="view"><div class="view-inner">
        <div class="notice notice--error"><span data-icon="warning"></span>
        <div class="notice__body"><span class="notice__title">这个页面没能打开</span>${MD.render(err.message)}
        <div class="view-toolbar"><button class="btn btn--outlined" onclick="location.reload()" type="button">重新加载软件</button></div></div></div></div></div>`);
    }

    if (node) content.appendChild(node);
    ICON.hydrate(content);
    if (id === 'chat') { content.appendChild(welcomeBlock()); renderMessages(); }
    content.scrollTop = id === 'chat' ? content.scrollHeight : 0;
  }

  /* ============ 欢迎块 ============ */

  function welcomeBlock() {
    return Views.el(`<div id="welcome">
      <div class="welcome">
        <h1 class="welcome__title">你好，我是药物经济学智能体</h1>
        <p class="welcome__lead">我用大白话教你药物经济学。不会的问题直接问，我会查内置知识库给你有出处的答案；涉及计算的，我会用计算器算给你看，而不是让你心算。</p>
        <div class="welcome__grid" id="welcomeCards">
          <button class="welcome__card" data-q="QALY 是什么意思？能用一个例子讲讲吗？" type="button">
            <span data-icon="lightbulb"></span>
            <span><span class="welcome__card-title">先搞懂 QALY</span><span class="welcome__card-desc">药物经济学最基础、也最容易考的概念</span></span>
          </button>
          <button class="welcome__card" data-q="ICER 怎么算？多少算划算？" type="button">
            <span data-icon="calculate"></span>
            <span><span class="welcome__card-title">算一个 ICER</span><span class="welcome__card-desc">为什么不能只看"贵不贵"</span></span>
          </button>
          <button class="welcome__card" data-q="中国药物经济学评价指南要求怎么贴现？" type="button">
            <span data-icon="flag"></span>
            <span><span class="welcome__card-title">中国指南怎么说</span><span class="welcome__card-desc">贴现率、参照药、医保谈判</span></span>
          </button>
          <button class="welcome__card" data-q="为什么要做概率敏感性分析 PSA？" type="button">
            <span data-icon="stacked_line_chart"></span>
            <span><span class="welcome__card-title">不确定性分析</span><span class="welcome__card-desc">让"结论可靠吗"变得可回答</span></span>
          </button>
        </div>
        <div style="margin-top:var(--sp-6);display:flex;gap:var(--sp-3);justify-content:center;flex-wrap:wrap">
          <button class="btn btn--primary btn--lg" data-go="path" type="button"><span data-icon="school"></span><span class="btn__label">从零开始系统学</span></button>
          <button class="btn btn--outlined btn--lg" data-go="calculator" type="button"><span data-icon="calculate"></span><span class="btn__label">直接去算</span></button>
        </div>
      </div>
    </div>`);
  }

  /* ============ 消息渲染 ============ */

  function renderMessages() {
    content.querySelectorAll('.msg').forEach((n) => n.remove());
    const w = content.querySelector('#welcome');
    if (w) w.style.display = state.history.length ? 'none' : '';

    for (const m of state.history) {
      if (m.role === 'system') continue;
      appendMessage(m.role === 'user' ? 'user' : 'ai', m.content, m.meta || {}, false);
    }
    content.scrollTop = content.scrollHeight;
  }

  function appendMessage(kind, text, meta, animate = true) {
    const w = content.querySelector('#welcome');
    if (w) w.style.display = 'none';

    const node = Views.el(`
      <div class="msg msg--${kind}">
        <div class="msg__avatar" aria-hidden="true">${kind === 'user' ? '我' : 'AI'}</div>
        <div class="msg__body">
          ${kind === 'ai' ? '<div class="msg__who">药物经济学智能体</div>' : ''}
          <div class="msg__content"></div>
          ${kind === 'ai' && meta && meta.suggestions && meta.suggestions.length ? `
            <div class="suggestions" style="margin-top:var(--sp-4)">
              <div class="suggestions__label">还想了解什么？点一下就能问：</div>
              ${meta.suggestions.map((s) => `<button class="chip chip--suggestion" data-sugg="${MD.esc(s)}" type="button">${MD.esc(s)}</button>`).join('')}
            </div>` : ''}
        </div>
      </div>`);

    const target = node.querySelector('.msg__content');
    target.innerHTML = MD.render(text);
    if (animate) node.style.animation = 'rise .25s var(--ease-emphasized-decel)';
    content.appendChild(node);

    // 绑定引用与建议
    node.querySelectorAll('[data-external]').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); pe.openExternal(a.getAttribute('href')); })
    );
    node.querySelectorAll('[data-sugg]').forEach((b) =>
      b.addEventListener('click', () => send(b.getAttribute('data-sugg')))
    );
    return node;
  }

  /** 思考过程折叠框 */
  function appendThinking() {
    const node = Views.el(`
      <div class="msg msg--ai" id="thinkingMsg">
        <div class="msg__avatar" aria-hidden="true">AI</div>
        <div class="msg__body">
          <div class="msg__who">药物经济学智能体</div>
          <div class="notice notice--info" id="thinkingStatus">
            <span class="spinner"></span>
            <div class="notice__body"><span class="notice__title" id="thinkingText">正在思考…</span>正在从知识库里找相关内容。</div>
          </div>
          <div class="thinking-box" id="thinkingSteps" style="display:none">
            <button class="thinking-box__head" type="button" id="thinkingToggle">
              <span data-icon="search" style="width:18px;height:18px"></span>
              <span>查看思考过程（工具调用记录）</span>
            </button>
            <div class="thinking-box__body" id="thinkingList"></div>
          </div>
        </div>
      </div>`);
    content.appendChild(node);
    content.scrollTop = content.scrollHeight;

    const toggle = node.querySelector('#thinkingToggle');
    toggle.addEventListener('click', () => {
      const box = node.querySelector('#thinkingSteps');
      box.classList.toggle('is-open');
    });
    return node;
  }

  function thinkingStatus(text) {
    const el = document.querySelector('#thinkingText');
    if (el) el.textContent = text;
  }

  function thinkingStep(step) {
    const list = document.querySelector('#thinkingList');
    const box = document.querySelector('#thinkingSteps');
    if (!list || !box) return;
    box.style.display = '';
    const label = toolLabel(step.name);
    list.insertAdjacentHTML('beforeend', `
      <div class="step-item">
        <span class="step-item__idx">${list.children.length + 1}</span>
        <div style="flex:1">
          <div><b>${MD.esc(label)}</b></div>
          <div style="color:var(--md-on-surface-variant);font-family:var(--font-mono);font-size:.8em;word-break:break-all">${MD.esc(JSON.stringify(step.args || {}))}</div>
          ${step.success === false ? '<div class="step-item__fail">参数有误，已自动修正后重试</div>' : ''}
        </div>
      </div>`);
    content.scrollTop = content.scrollHeight;
  }

  const TOOL_LABELS = {
    search_knowledge_base: '查知识库', explain_term: '查术语表', list_topics: '列知识库主题',
    get_checklist: '取报告规范清单', calc_icer: '算 ICER', calc_qaly: '算 QALY',
    calc_inmb: '算 INMB', calc_psa: '跑概率敏感性分析', calc_owsa: '跑单因素敏感性分析',
    calc_discount: '算折现', calc_bia: '算预算影响', calc_decision_tree: '算决策树期望值',
    calc_cba: '算成本-效益', calc_coi: '算疾病成本', build_report: '生成报告',
  };
  const toolLabel = (n) => TOOL_LABELS[n] || n;

  /* ============ 发送 ============ */

  async function send(text) {
    const q = String(text || '').trim();
    if (!q || state.sending) return;
    if (state.view !== 'chat') go('chat');

    state.sending = true;
    $('#sendBtn').setAttribute('data-busy', 'true');

    state.history.push({ role: 'user', content: q, meta: {} });
    renderMessages();
    askInput.value = '';
    autosize();

    const thinking = appendThinking();

    try {
      const res = await pe.ask(q, state.mode, state.sessionId, state.history.slice(0, -1));

      // 离线降级时给出明确说明，避免用户以为 AI 坏了
      if (res.offline) {
        thinking.remove();
        state.history.push({ role: 'assistant', content: res.text, meta: { suggestions: res.suggestions } });
        renderMessages();
        bumpOfflineNotice();
        return;
      }

      // 工具调用记录回填
      if (res.steps && res.steps.length) {
        res.steps.forEach((s) => s.results.forEach((r) =>
          thinkingStep({ name: r.call.name, args: r.call.arguments, success: r.response.success })));
      }

      thinking.remove();
      let body = res.text || '（没有生成内容）';
      if (res.reflection) {
        body += `\n\n### 🔍 自查发现\n\n${res.reflection}`;
      }
      if (res.truncated) {
        body += '\n\n---\n\n> 推理步骤已达上限。可以点「先规划再解答」重新试一次，或把问题拆小。';
      }
      const cites = [];
      if (res.citations) res.citations.forEach((c) => cites.push(c));
      state.history.push({ role: 'assistant', content: body, meta: { suggestions: suggestFor(q) } });
      if (res.history) state.history = res.history.concat([]);
      renderMessages();
    } catch (err) {
      thinking.remove();
      const tip = /api|key|401|403|timeout|network|fetch|ECONN/i.test(err.message)
        ? '\n\n> 提示：这通常是 API Key 或模型名称填错了。可以在「设置」里核对，或先切回离线模式继续用其他功能。'
        : '';
      state.history.push({ role: 'assistant', content: `抱歉，这次没能完成：\n\n${err.message}${tip}`, meta: {} });
      renderMessages();
    } finally {
      state.sending = false;
      $('#sendBtn').removeAttribute('data-busy');
      askInput.focus();
    }
  }

  function suggestFor(q) {
    const s = new Set();
    if (/qaly|效用/i.test(q)) s.add('QALY 计算公式是什么？');
    if (/icer|阈值|划算/i.test(q)) s.add('ICER 为负数怎么解读？');
    if (/psa|敏感|ceac/i.test(q)) s.add('CEAC 曲线怎么看？');
    if (/贴现|折现/i.test(q)) s.add('中国指南规定折现率取多少？');
    if (/bia|预算/i.test(q)) s.add('预算影响分析怎么算？');
    if (/中国|医保|指南/i.test(q)) s.add('CHEERS 2022 包括哪些条目？');
    if (!s.size) s.add('药物经济学评价的基本流程是什么？');
    return [...s].slice(0, 4);
  }

  function bumpOfflineNotice() {
    const badge = $('#modeBadge');
    badge.className = 'mode-badge mode-badge--offline';
    $('#modeText').textContent = '离线知识模式';
  }

  /* ============ 会话恢复 ============ */

  function restoreSession(s) {
    if (!s) return;
    state.sessionId = s.id;
    state.history = (s.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      meta: m.role === 'assistant' ? { suggestions: suggestFor(String(m.content).slice(0, 200)) } : {},
    }));
    go('chat');
    Views.toast(`已恢复「${s.title}」`);
  }

  /* ============ 设置变化 ============ */

  async function onSettingsChanged(r) {
    state.settings = await pe.getSettings();
    updateModeBadge();
  }

  function updateModeBadge() {
    const s = state.settings;
    if (!s) return;
    const badge = $('#modeBadge');
    if (s.isOffline) {
      badge.className = 'mode-badge mode-badge--offline';
      $('#modeText').textContent = '离线知识模式';
      badge.title = '未配置 API Key，正在使用内置知识库。全部功能可用。';
    } else {
      badge.className = 'mode-badge mode-badge--online';
      $('#modeText').textContent = `AI 模式 · ${s.model}`;
      badge.title = `已连接：${s.baseUrl}`;
    }
  }

  /* ============ 输入框 ============ */

  function autosize() {
    askInput.style.height = 'auto';
    askInput.style.height = `${Math.min(askInput.scrollHeight, 200)}px`;
  }

  function bindInput() {
    askInput.addEventListener('input', autosize);
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send(askInput.value);
      }
    });
    $('#sendBtn').addEventListener('click', () => send(askInput.value));
    $('#newChatBtn').addEventListener('click', () => {
      state.sessionId = newSessionId();
      state.history = [];
      go('chat');
      Views.toast('已开始新对话');
      askInput.focus();
    });
    $('#helpBtn').addEventListener('click', () => go('help'));

    document.querySelectorAll('.segmented__item').forEach((b) =>
      b.addEventListener('click', () => {
        document.querySelectorAll('.segmented__item').forEach((x) => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        state.mode = b.getAttribute('data-mode');
        const tips = {
          react: '按 Enter 发送，Shift + Enter 换行',
          plan: '先规划再解答：适合"帮我完整分析一个药"这类多步骤任务',
          reflect: '回答后自查：会再校一遍公式方向、符号和结论是否一致',
        };
        $('#inputTip').textContent = tips[state.mode];
      })
    );

    // 欢迎卡片与按钮
    content.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { send(q.getAttribute('data-q')); return; }
      const g = e.target.closest('[data-go]');
      if (g) { go(g.getAttribute('data-go')); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) copyResult(cp);
      const ex = e.target.closest('[data-export]');
      if (ex) exportResult(ex);
    });

    // 导出快捷键
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(askInput.value); }
    });
  }

  function copyResult(btn) {
    const card = btn.closest('.card') || document;
    const text = [...card.querySelectorAll('.result-card, .mini-table')]
      .map((n) => n.innerText)
      .join('\n\n');
    navigator.clipboard.writeText(text).then(
      () => Views.toast('结果已复制到剪贴板', 'success'),
      () => Views.toast('复制失败，请手动选中文字复制', 'error')
    );
  }

  async function exportResult(btn) {
    const card = btn.closest('.card') || document;
    const parts = [];
    const result = card.querySelector('.result-card');
    if (result) parts.push(`## 计算结果\n\n${result.innerText}`);
    const table = card.querySelector('.mini-table');
    if (table) {
      const head = [...table.querySelectorAll('th')].map((t) => t.innerText);
      const rows = [...table.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.innerText)
      );
      parts.push(`## 明细数据\n\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n` +
        rows.map((r) => `| ${r.join(' | ')} |`).join('\n'));
    }
    const teach = card.querySelector('.notice--primary');
    if (teach) parts.push(`## 怎么理解这个结果\n\n${teach.innerText}`);
    const md = [
      '# 药物经济学计算结果',
      '',
      `> 由「药物经济学智能体」生成 · ${new Date().toLocaleString('zh-CN')}`,
      '',
      ...parts,
      '',
      '---',
      '',
      '**声明**：本结果为学习辅助，不构成医疗、用药或医保决策建议。',
    ].join('\n');
    try {
      const r = await pe.saveFile(md, `药经计算结果_${Date.now()}.md`, '保存计算结果');
      if (r.saved) Views.toast(`已保存到：${r.path}`, 'success');
    } catch (err) {
      Views.toast(err.message, 'error');
    }
  }

  /* ============ Agent 事件流 ============ */

  function bindAgentEvents() {
    pe.onAgentEvent((evt) => {
      if (evt.type === 'tool_start') thinkingStatus(`正在调用「${toolLabel(evt.name)}」…`);
      else if (evt.type === 'notice') Views.toast(evt.message, 'info');
      else if (evt.type === 'plan') {
        thinkingStatus('已生成分析计划');
        const box = document.querySelector('#thinkingSteps');
        const list = document.querySelector('#thinkingList');
        if (box && list) {
          box.style.display = '';
          list.insertAdjacentHTML('beforeend',
            `<div class="step-item"><span class="step-item__idx">P</span><div style="flex:1">${MD.render(evt.content)}</div></div>`);
        }
      }
    });
  }

  /* ============ 启动 ============ */

  async function boot() {
    initTheme();
    ICON.hydrate(document); // 顶栏等 index.html 里的静态图标占位符
    buildNav();
    bindInput();
    bindAgentEvents();

    go('chat');

    try {
      state.appInfo = await pe.getAppInfo();
      if (state.appInfo.kbError) {
        Views.toast(`知识库加载失败：${state.appInfo.kbError}`, 'error');
      } else {
        const s = state.appInfo.kbStats;
        console.log(`[药物经济学智能体] 知识库已加载：${s.chunks} 条目 / ${s.glossary} 术语 / ${s.formulas} 公式`);
      }
    } catch (err) {
      Views.toast('读取软件信息失败：' + err.message, 'error');
    }

    try {
      state.settings = await pe.getSettings();
      updateModeBadge();
    } catch { /* 默认离线 */ }

    try {
      const b = await pe.browseKB();
      state.examples = b.examples || [];
    } catch { /* 忽略 */ }

    askInput.focus();
  }

  pe.onReady(() => askInput.focus());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
