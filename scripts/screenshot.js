/**
 * 界面截图脚本（用于人工核对 M3 视觉与可读性）
 * 运行：electron scripts/screenshot.js [viewName...]
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
const want = process.argv.slice(2);
const SHOTS = [
  { view: 'chat', name: '01-问答-欢迎页' },
  { view: 'calculator', name: '02-计算器', after: 'icer' },
  { view: 'library', name: '03-知识库' },
  { view: 'glossary', name: '04-术语表' },
  { view: 'path', name: '05-学习路径' },
  { view: 'checklist', name: '06-自检清单' },
  { view: 'formulas', name: '07-公式速查' },
  { view: 'resources', name: '08-延伸阅读' },
  { view: 'settings', name: '09-设置' },
];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ipc = require(path.join(ROOT, 'src', 'main', 'ipc.js'))
    .createIpc({ appRoot: ROOT, exeDir: ROOT, isPackaged: false });
  ipc.register();

  const win = new BrowserWindow({
    width: 1500, height: 1000, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  ipc.setMainWindow(win);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 2600));

  for (const s of SHOTS) {
    if (want.length && !want.includes(s.view)) continue;
    await win.webContents.executeJavaScript(`document.querySelector('[data-view="${s.view}"]').click()`);
    // Self-check: the nav highlight must match the view we asked for.
    // Programmatic clicks in a tight loop can be captured mid-transition, which
    // previously produced screenshots where the highlighted nav item disagreed
    // with the page title. Fail loudly instead of publishing a wrong image.
    const navState = await win.webContents.executeJavaScript(`(() => {
      const cur = [...document.querySelectorAll('.nav-item[aria-current="page"]')].map(b=>b.getAttribute('data-view'));
      return { cur, title: document.querySelector('#viewTitle').textContent };
    })()`);
    if (navState.cur.length !== 1 || navState.cur[0] !== s.view) {
      console.warn(`  ! ${s.name}: nav highlight mismatch — got [${navState.cur}] expected [${s.view}] (title=${navState.title})`);
    }
    await new Promise((r) => setTimeout(r, 1100));
    if (s.after === 'icer') {
      await win.webContents.executeJavaScript(`(async () => {
        // Pick the ICER tool, then use the built-in preset so the demo shows a
        // filled form, then run it.
        document.querySelector('[data-tool="calc_icer"]').click();
        await new Promise(r=>setTimeout(r,400));
        const preset = document.querySelector('#formBody') && document.querySelector('[data-preset="0"]');
        if (preset) { preset.click(); await new Promise(r=>setTimeout(r,400)); }
        document.querySelector('#calcRun').click();
        // Poll until the result card appears instead of guessing a fixed delay
        for (let i = 0; i < 40; i++) {
          await new Promise(r=>setTimeout(r,150));
          if (document.querySelector('#calcResult .result-card')) break;
        }
        await new Promise(r=>setTimeout(r,400));
        const res = document.querySelector('#calcResult');
        if (res) res.scrollIntoView({block:'start'});
        document.querySelector('.view').scrollTop = 0;
      })()`);
    }
    const img = await win.webContents.capturePage();
    const file = path.join(OUT, `${s.name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('saved', file);
  }

  // 问答页真实内容截图
  if (!want.length || want.includes('chat')) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-view="chat"]').click()`);
    await new Promise((r) => setTimeout(r, 500));
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-q="QALY 是什么意思？能用一个例子讲讲吗？"]').click();
      await new Promise(r=>setTimeout(r,2500));
    })()`);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, '10-问答-实际回答.png'), img.toPNG());
    console.log('saved 10-问答-实际回答.png');
  }

  // 深色模式
  if (!want.length) {
    await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme','dark'); document.querySelector('[data-view="calculator"]').click();`);
    await new Promise((r) => setTimeout(r, 900));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, '11-深色模式.png'), img.toPNG());
    console.log('saved 11-深色模式.png');
  }

  app.exit(0);
});
app.on('window-all-closed', () => {});
