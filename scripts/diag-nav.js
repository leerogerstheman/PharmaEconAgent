/** 检查导航高亮是否与当前视图一致 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
app.whenReady().then(async () => {
  const ipc = require(path.join(ROOT, 'src', 'main', 'ipc.js'))
    .createIpc({ appRoot: ROOT, exeDir: ROOT, isPackaged: false });
  ipc.register();
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'src', 'main', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ipc.setMainWindow(win);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));

  const res = await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r=>setTimeout(r,ms));
    const out = [];
    for (const v of ['calculator','path','glossary','settings','chat']) {
      document.querySelector('[data-view="'+v+'"]').click();
      await wait(500);
      const cur = [...document.querySelectorAll('.nav-item[aria-current="page"]')].map(b=>b.getAttribute('data-view'));
      const title = document.querySelector('#viewTitle').textContent;
      out.push('clicked=' + v + '  title=' + title + '  aria-current=[' + cur.join(',') + ']');
    }
    // 再检查 CSS 是否真的把它高亮了
    document.querySelector('[data-view="path"]').click();
    await wait(500);
    const el = document.querySelector('[data-view="path"]');
    const cs = getComputedStyle(el);
    const other = getComputedStyle(document.querySelector('[data-view="glossary"]'));
    out.push('path  bg=' + cs.backgroundColor);
    out.push('gloss bg=' + other.backgroundColor);
    return out;
  })()`);
  res.forEach(l => console.log('  ' + l));
  app.exit(0);
});
app.on('window-all-closed', () => {});
