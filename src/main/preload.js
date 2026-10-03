/**
 * Preload —— 渲染进程与主进程之间唯一的安全通道
 * ---------------------------------------------------------------
 * contextIsolation + sandbox 下，渲染进程拿不到 require / fs。
 * 这里只暴露一组具名方法，每个方法对应一个白名单 IPC 通道，
 * 参数与返回值都是普通数据结构，恶意知识库文本无法借此执行命令。
 */

const { contextBridge, ipcRenderer } = require('electron');

/** 统一解包 {ok, data, error} */
async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res || typeof res !== 'object') throw new Error('主进程无响应');
  if (!res.ok) throw new Error(res.error || '操作失败');
  return res.data;
}

contextBridge.exposeInMainWorld('pe', {
  /* 启动信息 */
  getAppInfo: () => call('app:info'),

  /* 知识库 */
  searchKB: (query, topic, topK) => call('kb:search', { query, topic, topK }),
  getEntry: (id) => call('kb:entry', { id }),
  getTopic: (topic) => call('kb:topic', { topic }),
  browseKB: () => call('kb:browse'),

  /* 工具 */
  listTools: () => call('tool:list'),
  callTool: (name, args) => call('tool:call', { name, args }),

  /* Agent */
  ask: (question, mode, sessionId, history) =>
    call('agent:ask', { question, mode, sessionId, history }),
  abort: () => call('agent:abort'),
  askOffline: (question) => call('offline:ask', { question }),

  /* 设置 */
  getSettings: () => call('settings:get'),
  saveSettings: (s) => call('settings:save', s),
  resetSettings: () => call('settings:reset'),

  /* 会话 */
  listSessions: () => call('session:list'),
  getSession: (id) => call('session:get', { id }),
  deleteSession: (id) => call('session:delete', { id }),
  clearSessions: () => call('session:clear'),

  /* 文件 */
  saveFile: (content, defaultName, title) =>
    call('file:save', { content, defaultName, title }),
  openReportFolder: () => call('file:openFolder'),
  openExternal: (url) => call('shell:open', { url }),

  /* 日志 */
  getTrace: () => call('log:trace'),

  /* 自检 */
  runDiag: () => call('diag:run'),

  /* 技能 */
  listSkills: () => call('skill:list'),

  /* 事件订阅（Agent 流式输出） */
  onAgentEvent: (cb) => {
    const listener = (_e, payload) => {
      try { cb(payload); } catch { /* 渲染侧异常不冒泡到主进程 */ }
    };
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  onReady: (cb) => {
    const listener = () => { try { cb(); } catch { /* 同上 */ } };
    ipcRenderer.on('app:ready', listener);
    return () => ipcRenderer.removeListener('app:ready', listener);
  },
});
