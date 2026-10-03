/**
 * IPC 装配层
 * ---------------------------------------------------------------
 * 把知识库、Agent、工具、会话存储、设置管理接成渲染进程可调用的服务。
 * 所有处理器都做输入校验，渲染进程拿不到 fs / child_process。
 */

const { ipcMain, dialog, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');

const { KnowledgeBase } = require('../knowledge/kb');
const { OfflineEngine } = require('../knowledge/offline-engine');
const { ToolRegistry } = require('../tools/registry');
const { buildDomainTools } = require('../tools/builtin/calculators');
const { ReActAgent, PlanAndSolveAgent, ReflectionAgent } = require('../agents');
const { LLM } = require('../core/llm-adapters');
const { LLMConfig, loadLLMConfig, saveLLMConfig } = require('../core/llm');
const { TraceLogger } = require('../observability/trace-logger');
const { SessionStore } = require('../memory/session-store');
const { SkillLoader } = require('../skills/loader');

/** 包装处理器：统一捕获异常并转成 {ok:false,error} */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_evt, payload) => {
    try {
      return { ok: true, data: await fn(payload) };
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function createIpc(ctx) {
  const { appRoot, exeDir, isPackaged } = ctx;

  // ---- 路径解析：portable 模式下 exe 目录才是用户可见的工作区 ----
  // exeDir 由 main.js 以字符串传入（portable 单文件模式下 __dirname 是临时目录，不能用）
  const userData = app.getPath('userData');
  const configPath = path.join(userData, 'config.json');
  const sessionsDir = path.join(userData, 'sessions');
  const logDir = path.join(userData, 'logs');
  const reportDir = path.join(exeDir, '我的报告');

  // 知识库：优先用 exe 旁的自定义知识库（允许用户增补），否则用内置的
  const externalKb = path.join(exeDir, '知识库', 'kb.json');
  const builtinKb = path.join(appRoot, 'dist', 'kb.json');

  const kb = new KnowledgeBase();
  let kbSource = '';
  try {
    if (fs.existsSync(externalKb)) {
      kb.load(externalKb);
      kbSource = '自定义知识库（文件夹 知识库\\kb.json）';
    } else if (fs.existsSync(builtinKb)) {
      kb.load(builtinKb);
      kbSource = '内置知识库';
    } else {
      throw new Error(`找不到知识库文件。已查找：\n${externalKb}\n${builtinKb}`);
    }
  } catch (err) {
    // 知识库坏了也要能启动，界面会显示明确提示
    console.error('[ipc] 知识库加载失败', err);
    kb.loadError = err.message;
  }

  const offlineEngine = new OfflineEngine(kb);
  const tools = new ToolRegistry().registerAll(buildDomainTools(kb));
  const sessions = new SessionStore(sessionsDir);
  const skills = new SkillLoader(appRoot, kb);

  for (const d of [userData, sessionsDir, logDir]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* 忽略 */ }
  }
  try { fs.mkdirSync(reportDir, { recursive: true }); } catch { /* 忽略 */ }

  /** 读取当前 LLM 配置并构造 Agent */
  function makeAgent(mode) {
    const cfg = loadLLMConfig(configPath);
    const llm = new LLM(cfg);
    const shared = {
      toolRegistry: tools,
      sessionState: { offlineEngine, analysisType: null, assumptions: {} },
      logDir,
    };
    let agent;
    if (mode === 'plan') agent = new PlanAndSolveAgent('药经规划求解智能体', llm, shared);
    else if (mode === 'reflect') agent = new ReflectionAgent('药经审校智能体', llm, shared);
    else agent = new ReActAgent('药经智能体', llm, shared);
    return { agent, llm, cfg };
  }

  const register = () => {
    /* ---------- 启动信息 ---------- */
    handle('app:info', async () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      isPackaged,
      appRoot,
      exeDir,
      reportDir,
      kbSource,
      kbStats: kb.stats,
      kbError: kb.loadError || null,
      tools: tools.list(),
    }));

    /* ---------- 知识库 ---------- */
    handle('kb:search', async ({ query, topic, topK }) =>
      kb.search(query, { topic, topK: topK || 6 }).map((c) => ({
        id: c.id, title: c.title, topic: c.topic, topicName: c.topicName,
        type: c.type, level: c.level, content: c.content,
        source: c.source, url: c.url, year: c.year, score: c.score,
      }))
    );

    handle('kb:entry', async ({ id }) => kb.get(id));
    handle('kb:topic', async ({ topic }) =>
      kb.byTopic(topic).map((c) => ({ id: c.id, title: c.title, type: c.type, level: c.level, summary: (c.content || '').slice(0, 160) }))
    );
    handle('kb:browse', async () => ({
      topics: kb.topics,
      glossary: kb.glossary,
      formulas: kb.formulas,
      checklists: kb.checklists,
      resources: kb.resources,
      learningPath: kb.learningPath || [],
      examples: kb.examples || [],
    }));

    /* ---------- 工具（计算器） ---------- */
    handle('tool:list', async () => tools.getSpecs());
    handle('tool:call', async ({ name, args }) => {
      const t = tools.get(name);
      if (!t) throw new Error(`没有名为「${name}」的工具`);
      const r = await t.execute(args || {});
      return { content: r.content, success: r.success, meta: r.meta };
    });

    /* ---------- Agent 问答 ---------- */
    handle('agent:ask', async ({ question, mode, sessionId, history }) => {
      if (!question || !String(question).trim()) throw new Error('问题不能为空');
      const { agent, llm } = makeAgent(mode || 'react');
      currentAgents.push(agent);
      // 同时只保留最近 3 个 Agent 引用，避免内存与中止句柄泄漏
      while (currentAgents.length > 3) currentAgents.shift();

      if (Array.isArray(history) && history.length) {
        agent.history.restore(history);
        agent.history.addUser(question);
      }

      // 无模型配置 → 直接走离线引擎
      if (!llm.available) {
        const res = offlineEngine.answer(question);
        const trace = new TraceLogger({ agent: 'offline' });
        trace.start(question);
        trace.ok('offline', '离线知识引擎作答');
        return {
          text: res.text,
          offline: true,
          suggestions: res.suggestions,
          actions: res.actions,
          citations: res.chunks,
          terms: (res.terms || []).map((t) => ({ term: t.term, abbr: t.abbr, definition: t.definition })),
          history: agent.history.snapshot(),
        };
      }

      // 有模型 → 检索 + ReAct；事件通过下面的 channel 推送
      const chunks = kb.search(question, { topK: 5 }).map((c) => ({
        title: c.title, topic: c.topic, topicName: c.topicName,
        content: c.content, source: c.source, url: c.url, year: c.year, score: c.score,
      }));

      const events = [];
      agent.onEvent = (evt) => {
        events.push(evt);
        if (evt.type === 'message' || evt.type === 'tool_end' || evt.type === 'notice' || evt.type === 'plan') {
          sendToRenderer('agent:event', evt);
        }
      };

      let result;
      if (mode === 'plan' && typeof agent.runWithPlan === 'function') {
        result = await agent.runWithPlan(question, { chunks });
      } else {
        result = await agent.run(question, { chunks });
      }

      // 保存会话
      if (sessionId) {
        try {
          sessions.save({
            id: sessionId,
            title: String(question).slice(0, 40),
            updatedAt: Date.now(),
            messages: agent.history.snapshot().filter((m) => m.role !== 'system'),
          });
        } catch { /* 存储失败不影响作答 */ }
      }

      return {
        text: result.text,
        offline: false,
        steps: result.steps || [],
        truncated: !!result.truncated,
        reflection: agent.lastReflection || null,
        citations: chunks.slice(0, 3).map((c) => ({ id: c.title, title: c.title, source: c.source, url: c.url })),
        history: agent.history.snapshot(),
      };
    });

    handle('agent:abort', async () => {
      try { currentAgents.forEach((a) => a.abort()); } catch { /* 忽略 */ }
      return true;
    });

    /* ---------- 离线直接问答（不经过 Agent） ---------- */
    handle('offline:ask', async ({ question }) => {
      const res = offlineEngine.answer(question);
      return {
        text: res.text, suggestions: res.suggestions, actions: res.actions,
        citations: res.chunks, intent: res.intent,
      };
    });

    /* ---------- 设置 ---------- */
    handle('settings:get', async () => {
      const cfg = loadLLMConfig(configPath);
      return {
        provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl,
        hasKey: !!cfg.apiKey,
        keyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 6)}••••${cfg.apiKey.slice(-4)}` : '',
        temperature: cfg.temperature,
        isOffline: cfg.provider === 'offline',
        configPath,
      };
    });

    handle('settings:save', async ({ model, baseUrl, apiKey, provider, temperature }) => {
      const prev = loadLLMConfig(configPath);
      const next = new LLMConfig({
        model: model || prev.model,
        baseUrl: baseUrl !== undefined ? baseUrl : prev.baseUrl,
        apiKey: apiKey !== undefined ? apiKey : prev.apiKey,
        provider: provider || 'auto',
        temperature: temperature !== undefined ? temperature : prev.temperature,
      });
      if (next.provider !== 'offline' && !next.apiKey && next.provider === 'auto' && next.baseUrl === prev.baseUrl) {
        throw new Error('请填写 API Key，或选择「离线模式」');
      }
      saveLLMConfig(configPath, next);
      return { ok: true, provider: next.provider, model: next.model, hasKey: !!next.apiKey };
    });

    handle('settings:reset', async () => {
      saveLLMConfig(configPath, { provider: 'offline' });
      return { ok: true };
    });

    /* ---------- 会话历史 ---------- */
    handle('session:list', async () => sessions.list());
    handle('session:get', async ({ id }) => sessions.get(id));
    handle('session:delete', async ({ id }) => sessions.remove(id));
    handle('session:clear', async () => sessions.clearAll());

    /* ---------- 文件导出 ---------- */
    handle('file:save', async ({ content, defaultName, title }) => {
      const res = await dialog.showSaveDialog(mainWindowRef, {
        title: title || '保存文件',
        defaultPath: path.join(reportDir, defaultName || '报告.md'),
        filters: [
          { name: 'Markdown 文档', extensions: ['md'] },
          { name: '文本文件', extensions: ['txt'] },
          { name: 'HTML 网页', extensions: ['html'] },
        ],
      });
      if (res.canceled || !res.filePath) return { saved: false };
      try {
        fs.writeFileSync(res.filePath, content, 'utf-8');
        return { saved: true, path: res.filePath };
      } catch (err) {
        throw new Error(`保存失败：${err.message}`);
      }
    });

    handle('file:openFolder', async () => {
      try { fs.mkdirSync(reportDir, { recursive: true }); } catch { /* 忽略 */ }
      await shell.openPath(reportDir);
      return { path: reportDir };
    });

    handle('shell:open', async ({ url }) => {
      if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('只允许打开 http/https 链接');
      await shell.openExternal(url);
      return true;
    });

    /* ---------- 日志 ---------- */
    handle('log:trace', async () => {
      try {
        const files = fs.readdirSync(logDir).filter((f) => f.startsWith('trace-')).sort().reverse();
        if (!files.length) return { lines: [] };
        const raw = fs.readFileSync(path.join(logDir, files[0]), 'utf-8');
        const lines = raw.trim().split('\n').slice(-200).map((l) => {
          try { return JSON.parse(l); } catch { return { msg: l }; }
        });
        return { file: files[0], lines };
      } catch (err) {
        return { lines: [], error: err.message };
      }
    });

    /* ---------- 技能（Skills） ---------- */
    handle('skill:list', async () => skills.list());

    /* ---------- 启动自检（用户报障时可转发日志文件） ---------- */
    handle('diag:run', async () => {
      const { reportStartupCheck } = require('./diagnostics');
      return reportStartupCheck({ kb, tools, sessions, logDir, exeDir, appRoot, isPackaged });
    });
  };

  /* ---------------- 内部工具 ---------------- */
  const currentAgents = [];
  let mainWindowRef = null;
  const { BrowserWindow } = require('electron');
  const setMainWindow = (w) => { mainWindowRef = w; };
  const sendToRenderer = (channel, payload) => {
    const w = mainWindowRef || BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  return {
    register, setMainWindow, tools, kb, sessions, skills,
    diagCtx: { kb, tools, sessions, logDir, exeDir, reportDir, appRoot, isPackaged },
  };
}

module.exports = { createIpc };
