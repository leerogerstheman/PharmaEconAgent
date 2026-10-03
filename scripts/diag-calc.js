/** 一次性诊断：走一遍计算器 UI 链路，报告每一步的 DOM 状态 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
app.whenReady().then(async () => {
  const ipc = require(path.join(ROOT, 'src', 'main', 'ipc.js'))
    .createIpc({ appRoot: ROOT, exeDir: ROOT, isPackaged: false });
  ipc.register();
  const win = new BrowserWindow({
    width: 1500, height: 1000, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ipc.setMainWindow(win);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));

  const trace = await win.webContents.executeJavaScript(`(async () => {
    const log = [];
    const wait = (ms) => new Promise(r=>setTimeout(r,ms));
    document.querySelector('[data-view="calculator"]').click();
    await wait(600);
    log.push('view switched, tabs=' + document.querySelectorAll('[data-tool]').length);
    document.querySelector('[data-tool="calc_icer"]').click();
    await wait(500);
    const fill = () => [...document.querySelectorAll('#formBody input[data-key]')].map(i=>i.getAttribute('data-key')+'='+(i.value||'(空)'));
    log.push('after tool tab: ' + fill().join(' | '));
    const p0 = document.querySelector('[data-preset="0"]');
    log.push('preset button found: ' + !!p0);
    p0.click();
    await wait(600);
    log.push('after preset: ' + fill().join(' | '));
    const run = document.querySelector('#calcRun');
    log.push('run button found: ' + !!run);
    run.click();
    await wait(2500);
    const card = document.querySelector('#calcResult .result-card');
    log.push('result card present: ' + !!card);
    if (card) log.push('headline: ' + (card.querySelector('.result-card__headline')||{}).textContent);
    log.push('has table: ' + !!document.querySelector('#calcResult .mini-table'));
    log.push('has teaching note: ' + !!document.querySelector('#calcResult .notice--primary'));
    return log;
  })()`);
  trace.forEach((l) => console.log('  ' + l));

  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots', '02-计算器.png'), img.toPNG());
  console.log('saved shots/02-计算器.png');
  app.exit(0);
});
app.on('window-all-closed', () => {});
