/**
 * Electron 主进程
 * ---------------------------------------------------------------
 * 职责：窗口管理、路径解析、单例锁、启动装配。
 * 渲染进程完全禁用 Node（contextIsolation + sandbox），
 * 所有能力通过 preload 暴露的白名单 IPC 调用 —— 这样即使知识库内容
 * 含有恶意文本，也无法执行系统命令。
 */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 打包后的 __dirname 指向临时解压目录，必须用 app.getAppPath() 定位资源
const IS_PACKAGED = app.isPackaged;
const APP_ROOT = IS_PACKAGED ? app.getAppPath() : path.resolve(__dirname, '..', '..');

/**
 * 解析"用户看到的那个 exe 所在目录"。
 *
 * 这是 portable 单文件模式最容易踩的坑：NSIS 自解压启动器会把应用解到
 * `%TEMP%\XXXX\` 再运行，此时 `__dirname` / `app.getPath('exe')` /
 * `process.execPath` **全部指向临时目录**。
 * 如果照它们定位「我的报告」文件夹，用户导出的报告会在系统清理临时目录时一起消失；
 * 放在 exe 旁边的「知识库」「skills」也会永远读不到。
 *
 * electron-builder 的 portable 启动器会设置 PORTABLE_EXECUTABLE_DIR /
 * PORTABLE_EXECUTABLE_FILE 指向启动器自身，据此还原真实路径。
 * 非 portable（开发模式 / 安装版）则退回 app.getPath('exe')。
 */
function resolveExeDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && fs.existsSync(portableDir)) return path.resolve(portableDir);
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableFile && fs.existsSync(portableFile)) return path.dirname(path.resolve(portableFile));
  return path.dirname(app.getPath('exe'));
}

let mainWindow = null;
let ipc = null;

/* ---------------- 单例锁 ---------------- */
const gotLock = IS_PACKAGED ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  // 按主显示器可用区域取尺寸，避免在多屏/小屏环境里窗口开出可视区域之外
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(1100, Math.min(1480, area.width - 80));
  const height = Math.max(700, Math.min(1000, area.height - 80));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    backgroundColor: '#fdf8fd',
    title: '药物经济学智能体',
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  /**
   * 启动自检：跑一遍关键路径并写进轨迹日志。
   * 既是给用户的报障材料，也是打包版可用性的可验证凭证。
   * 全程 try/catch —— 自检失败绝不能阻止窗口打开。
   */
  if (ipc && ipc.diagCtx) {
    const { reportStartupCheck } = require('./diagnostics');
    setTimeout(() => {
      reportStartupCheck(ipc.diagCtx)
        .then((r) => {
          console.log(`[startup-check] ${r.passed} 项通过 / ${r.failed} 项失败`);
          if (r.failed) {
            r.items.filter((i) => !i.pass).forEach((i) => console.warn(`  ✗ ${i.name} — ${i.detail}`));
          }
        })
        .catch((e) => console.warn('[startup-check] 失败', e.message));
    }, 1500);
  }

  let shown = false;
  const showOnce = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', () => {
    showOnce();
    mainWindow.webContents.send('app:ready');
  });

  /**
   * 兜底：ready-to-show 在某些机器上可能因首帧迟迟不绘制而不触发，
   * 那样用户双击 exe 后会"什么都没发生"——这是最不能接受的失败模式。
   * 因此无论渲染是否就绪，3 秒后强制显示窗口。
   */
  const fallback = setTimeout(showOnce, 3000);
  mainWindow.once('show', () => clearTimeout(fallback));

  // 加载失败时明确告知，而不是留一个白窗口
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    dialog.showErrorBox(
      '界面加载失败',
      `无法加载软件界面（${code} ${desc}）。\n\n请确认文件夹完整，然后重新双击打开。`
    );
  });

  // 外部链接交给系统浏览器，绝不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    clearTimeout(fallback);
    mainWindow = null;
  });
}

/* ---------------- 启动 ---------------- */

app.whenReady().then(async () => {
  try {
    ipc = require('./ipc').createIpc({
      appRoot: APP_ROOT,
      exeDir: resolveExeDir(),
      isPackaged: IS_PACKAGED,
    });
    ipc.register();
    createWindow();
    if (ipc.setMainWindow) ipc.setMainWindow(mainWindow);
  } catch (err) {
    dialog.showErrorBox(
      '启动失败',
      `药物经济学智能体初始化时出错：\n\n${err.message}\n\n请确认文件夹完整（不要只复制 exe），` +
        `或联系技术支持并提供此信息。`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- 崩溃兜底：别让用户对着白屏发呆 ---------------- */

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err);
  try {
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '程序遇到问题',
        message: '程序遇到了一个未处理的错误，已记录到日志文件。',
        detail: String(err && err.stack ? err.stack : err),
        buttons: ['继续使用', '退出程序'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 1) app.quit();
      });
    }
  } catch {
    /* 兜底失败则静默退出 */
  }
});

module.exports = { resolveExeDir, APP_ROOT };
