/**
 * 端到端自检脚本
 * ---------------------------------------------------------------
 * 用 Electron 真实加载渲染页面，捕获所有 console 报错与未捕获异常，
 * 并逐个调用 IPC 通道验证后端可用。
 * 运行：npx electron scripts/selftest.js
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const checks = [];

function ok(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) problems.push(name);
}

app.whenReady().then(async () => {
  console.log('\n=== 药物经济学智能体 · 端到端自检 ===\n');

  // 1) 装配 IPC
  const ipc = require(path.join(ROOT, 'src', 'main', 'ipc.js')).createIpc({
    appRoot: ROOT,
    exeDir: ROOT,
    isPackaged: false,
  });
  ipc.register();
  console.log('[1] IPC 装配\n');

  // 2) 打开窗口并监听渲染进程错误
  const win = new BrowserWindow({
    width: 1440, height: 960, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  ipc.setMainWindow(win);

  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message, line, source) => {
    const lv = typeof level === 'number' ? level : e.level;
    if (lv >= 2) consoleErrors.push(`${message} (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleErrors.push('渲染进程崩溃: ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    consoleErrors.push(`加载失败 ${code} ${desc} ${url}`)
  );
  win.webContents.on('preload-error', (_e, p, err) =>
    consoleErrors.push(`preload 错误 ${p}: ${err.message}`)
  );

  console.log('  … 正在加载渲染页面');
  const loaded = await Promise.race([
    win.loadFile(path.join(ROOT, 'renderer', 'index.html')).then(() => true).catch((e) => {
      consoleErrors.push('loadFile 抛错: ' + e.message);
      return false;
    }),
    new Promise((r) => setTimeout(() => r('timeout'), 20000)),
  ]);
  console.log('  … 加载结果：' + loaded);
  await new Promise((r) => setTimeout(r, 2500));

  console.log('[2] 渲染进程\n');
  ok('页面加载完成', loaded === true, String(loaded));
  ok('无加载/启动期报错', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

  // 3) 关键 DOM 结构
  console.log('\n[3] 界面结构\n');
  const dom = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    return {
      navCount: document.querySelectorAll('.nav-item').length,
      hasInput: !!q('#askInput'),
      hasSend: !!q('#sendBtn'),
      welcome: !!q('#welcome'),
      welcomeCards: document.querySelectorAll('.welcome__card').length,
      svgIcons: document.querySelectorAll('svg.icon').length,
      leftoverPlaceholders: document.querySelectorAll('[data-icon]').length,
      buttonMinHeight: (() => { const b=q('#sendBtn'); return b? getComputedStyle(b).minHeight : 'n/a'; })(),
      bodyFont: getComputedStyle(document.body).fontSize,
    };
  })()`);
  ok('导航项数量正确（10 项）', dom.navCount === 10, `实际 ${dom.navCount}`);
  ok('输入框与发送按钮存在', dom.hasInput && dom.hasSend);
  ok('欢迎卡片已渲染', dom.welcome && dom.welcomeCards === 4, `${dom.welcomeCards} 张`);
  ok('SVG 图标已水合', dom.svgIcons > 10 && dom.leftoverPlaceholders === 0, `${dom.svgIcons} 个图标 / ${dom.leftoverPlaceholders} 个未替换占位`);
  ok('主按钮触控高度 ≥ 48px', parseFloat(dom.buttonMinHeight) >= 48, dom.buttonMinHeight);
  ok('正文字号 ≥ 16px', parseFloat(dom.bodyFont) >= 16, dom.bodyFont);

  // 4) 逐个切换视图，验证无异常
  console.log('\n[4] 视图切换\n');
  const views = ['calculator', 'library', 'glossary', 'formulas', 'path', 'checklist', 'resources', 'history', 'settings', 'chat'];
  for (const v of views) {
    const before = consoleErrors.length;
    await win.webContents.executeJavaScript(`document.querySelector('[data-view="${v}"]').click()`);
    await new Promise((r) => setTimeout(r, v === 'calculator' ? 700 : 550));
    const n = consoleErrors.length - before;
    ok(`视图「${v}」正常渲染`, n === 0, n ? consoleErrors[before] : '');
  }

  // 5) 计算器端到端：填表 → 执行 → 出结果
  console.log('\n[5] 计算器端到端\n');
  await win.webContents.executeJavaScript(`document.querySelector('[data-view="calculator"]').click()`);
  await new Promise((r) => setTimeout(r, 700));
  const calcResult = await win.webContents.executeJavaScript(`(async () => {
    const setVal = (sel, v) => { const el = document.querySelector(sel); if(!el) return false;
      el.value = String(v); el.dispatchEvent(new Event('input',{bubbles:true})); return true; };
    // 切到 ICER 计算器
    document.querySelector('[data-tool="calc_icer"]').click();
    await new Promise(r=>setTimeout(r,300));
    const inputs = [...document.querySelectorAll('#formBody input[data-key]')];
    const labels = inputs.map(i=>i.getAttribute('data-key'));
    const vals = { cost_comparator:100000, effect_comparator:3.0, cost_intervention:160000, effect_intervention:3.4, threshold:100000 };
    labels.forEach(k=>{ if(vals[k]!==undefined) setVal('#formBody input[data-key="'+k+'"]', vals[k]); });
    document.querySelector('#calcRun').click();
    await new Promise(r=>setTimeout(r,1200));
    const out = document.querySelector('#calcResult');
    return { html: out.innerHTML.length, text: out.innerText.slice(0,240), hasTable: !!out.querySelector('.mini-table'), hasTeach: !!out.querySelector('.notice--primary') };
  })()`);
  ok('ICER 计算返回结果卡片', calcResult.html > 200, `${calcResult.html} 字符`);
  ok('结果包含明细表格', calcResult.hasTable);
  ok('结果附带教学解释', calcResult.hasTeach);
  // ICER = 150,000 元/QALY，阈值 100,000 → 正确结论应为"不具成本效果"
  ok('阈值判定正确（150k > 100k → 不具成本效果）', /不具成本效果/.test(calcResult.text), calcResult.text.split('\n')[0]);

  // 6) 反向验证：更贵且更差 → 必须判定为被支配，且不得说"具有成本效果"
  console.log('\n[6] 方法学正确性反向验证\n');
  const dom2 = await win.webContents.executeJavaScript(`(async () => {
    const setVal = (k,v)=>{ const el=document.querySelector('#formBody input[data-key="'+k+'"]'); el.value=String(v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    setVal('cost_comparator',100000); setVal('effect_comparator',3.4);
    setVal('cost_intervention',160000); setVal('effect_intervention',3.0);
    setVal('threshold',100000);
    document.querySelector('#calcRun').click();
    await new Promise(r=>setTimeout(r,1200));
    const out = document.querySelector('#calcResult');
    return { text: out.innerText.slice(0,600), tone: out.querySelector('.result-card').className };
  })()`);
  ok('更贵且更差 → 判定为被支配', /支配/.test(dom2.text), dom2.text.split('\n').slice(0,2).join(' '));
  ok('被支配方案不得声称"具有成本效果"', !/具有成本效果/.test(dom2.text),
     /具有成本效果/.test(dom2.text) ? '错误地给出了"具有成本效果"' : '');
  ok('被支配方案用错误色标示', /error/.test(dom2.tone), dom2.tone);

  // 6b) 阈值足够高时应翻转为"具有成本效果"
  const dom3 = await win.webContents.executeJavaScript(`(async () => {
    const setVal = (k,v)=>{ const el=document.querySelector('#formBody input[data-key="'+k+'"]'); el.value=String(v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    setVal('effect_comparator',3.0); setVal('effect_intervention',3.4); setVal('threshold',200000);
    document.querySelector('#calcRun').click();
    await new Promise(r=>setTimeout(r,1200));
    return document.querySelector('#calcResult').innerText.slice(0,200);
  })()`);
  ok('阈值 20 万 > ICER 15 万 → 翻转为"具有成本效果"', /具有成本效果/.test(dom3), dom3.split('\n')[0]);

  // 7) 离线问答端到端
  console.log('\n[7] 离线知识问答\n');
  const qa = await win.webContents.executeJavaScript(`(async () => {
    const r = await window.pe.askOffline('QALY 是什么意思');
    return { len: r.text.length, intent: r.intent, sugg: (r.suggestions||[]).length, cites: (r.citations||[]).length, head: r.text.slice(0,120) };
  })()`);
  ok('离线问答返回内容', qa.len > 300, `${qa.len} 字符`);
  ok('识别为术语类问题', qa.intent === 'term', qa.intent);
  ok('附带推荐问题', qa.sugg > 0, `${qa.sugg} 条`);
  ok('附带引用来源', qa.cites > 0, `${qa.cites} 条`);

  // 8) Agent 完整走一遍（无 API Key → 应自动走离线）
  console.log('\n[8] Agent 端到端\n');
  const ag = await win.webContents.executeJavaScript(`(async () => {
    const r = await window.pe.ask('成本效果分析的基本流程是什么？', 'react', 'test-sess-1', []);
    return { len: (r.text||'').length, offline: r.offline, sugg: (r.suggestions||[]).length };
  })()`);
  ok('Agent 返回回答', ag.len > 300, `${ag.len} 字符`);
  ok('未配置 Key 时自动降级为离线', ag.offline === true);

  // 9) 术语表与公式
  console.log('\n[9] 知识库内容\n');
  const info = await win.webContents.executeJavaScript('window.pe.getAppInfo()');
  ok('知识库条目 ≥ 15', info.kbStats.chunks >= 15, `${info.kbStats.chunks} 条`);
  ok('术语表 ≥ 30', info.kbStats.glossary >= 30, `${info.kbStats.glossary} 个`);
  ok('公式 ≥ 15', info.kbStats.formulas >= 15, `${info.kbStats.formulas} 个`);
  ok('报告清单 ≥ 4', info.kbStats.checklists >= 4, `${info.kbStats.checklists} 份`);
  ok('工具数量 = 15', info.tools.length === 15, `${info.tools.length} 个`);
  ok('知识库来源可识别', !!info.kbSource, info.kbSource);

  // 10) 安全性：渲染进程不应有 Node 权限
  console.log('\n[10] 安全\n');
  const sec = await win.webContents.executeJavaScript(`({
    hasRequire: typeof require !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    pePresent: typeof window.pe !== 'undefined',
    peKeys: window.pe ? Object.keys(window.pe).length : 0
  })`);
  ok('渲染进程无 require', !sec.hasRequire);
  ok('渲染进程无 process', !sec.hasProcess);
  ok('preload 暴露了受控 API', sec.pePresent && sec.peKeys > 15, `${sec.peKeys} 个方法`);

  // 11) 学习路径与示例数据确实加载
  console.log('\n[11] 学习数据\n');
  const learn = await win.webContents.executeJavaScript('window.pe.browseKB()');
  ok('学习路径已加载', (learn.learningPath || []).length >= 13, `${(learn.learningPath || []).length} 步`);
  ok('教学示例已加载', (learn.examples || []).length >= 8, `${(learn.examples || []).length} 个`);

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.pass).length;
  console.log('\n' + '='.repeat(56));
  console.log(`  结果：${pass} / ${checks.length} 项通过`);
  if (problems.length) {
    console.log('  失败项：');
    problems.forEach((p) => console.log('    ✗ ' + p));
  } else {
    console.log('  全部通过 ✓');
  }
  console.log('='.repeat(56) + '\n');

  app.exit(problems.length ? 1 : 0);
});

app.on('window-all-closed', () => {});
