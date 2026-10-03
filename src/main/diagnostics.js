/**
 * 启动自检
 * ---------------------------------------------------------------
 * 目标用户遇到问题时，最缺的就是"可转发给别人的诊断信息"。
 * 本模块在窗口创建后跑一遍关键路径自检，把结果写进轨迹日志，
 * 用户只要把 logs 文件夹里的文件发出去，就能定位问题。
 *
 * 同时它也是打包版可用性的可验证凭证：日志里有 OK 记录，
 * 就说明「asar 资源 → 知识库加载 → 工具注册 → 计算执行 → 检索问答」
 * 整条链路在真实打包环境下是通的。
 */

const { ToolRegistry } = require('../tools/registry');
const { buildDomainTools } = require('../tools/builtin/calculators');
const M = require('../domain/math');
const fs = require('fs');
const path = require('path');

/**
 * @param {object} ctx {kb, tools, sessions, logDir, exeDir, reportDir, appRoot, isPackaged}
 * @returns {Promise<{passed:number, failed:number, items:Array}>}
 */
async function runStartupCheck(ctx) {
  const { kb, tools, sessions, logDir, exeDir, reportDir, appRoot, isPackaged } = ctx;
  const items = [];
  const check = (name, pass, detail = '') => items.push({ name, pass: !!pass, detail: String(detail) });

  /* ---- 1. 运行环境 ---- */
  check('应用已打包', !!isPackaged, isPackaged ? '正式版' : '开发模式');
  check('资源根目录可读', !!appRoot, appRoot);

  /**
   * portable 单文件模式下最关键的一条：用户可见的 exe 目录必须被正确解析。
   * 若这里落到 %TEMP%，导出的报告会随临时目录清理一起消失。
   */
  const isTemp = /[\\/]Temp[\\/]|[\\/]tmp[\\/]/i.test(exeDir);
  check('exe 所在目录解析正确（不指向临时目录）', !isTemp, exeDir);
  check('「我的报告」文件夹可写', (() => {
    try {
      fs.mkdirSync(reportDir, { recursive: true });
      const probe = path.join(reportDir, '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  })(), reportDir);

  /* ---- 2. 知识库 ---- */
  const st = kb.stats;
  check('知识库已加载', kb.loaded, st.chunks + ' 条目');
  check('知识库规模达标', st.chunks >= 10 && st.glossary >= 20,
    `${st.chunks} 条目 / ${st.glossary} 术语 / ${st.formulas} 公式`);
  check('主题索引完整', st.topics > 0, st.topics + ' 个主题');
  check('术语表可用', kb.lookupTerm('ICER').length > 0);
  check('学习路径已加载', (kb.learningPath || []).length > 0, (kb.learningPath || []).length + ' 步');
  check('教学示例已加载', (kb.examples || []).length > 0, (kb.examples || []).length + ' 个');

  /* ---- 3. 检索链路 ---- */
  try {
    const hits = kb.search('ICER 怎么算', { topK: 3 });
    check('知识检索可用', hits.length > 0, hits.map((h) => h.title).join(' / '));
  } catch (e) {
    check('知识检索可用', false, e.message);
  }

  /* ---- 4. 工具注册与执行 ---- */
  check('工具注册完整', tools.list().length >= 15, tools.list().length + ' 个');
  try {
    const r = await tools.get('calc_icer').execute({
      cost_comparator: 100000, effect_comparator: 3.0,
      cost_intervention: 160000, effect_intervention: 3.4,
    });
    // 浮点比较必须用容差：60000/0.4 在 IEEE754 下是 150000.00000000003
    const okIcer = r.success && r.meta.kind === 'icer' && Math.abs(r.meta.icer - 150000) < 1e-6;
    check('ICER 工具可执行', okIcer, 'ICER=' + r.meta.icer);
  } catch (e) {
    check('ICER 工具可执行', false, e.message);
  }

  /* ---- 5. PSA 可复现性（教学场景的关键保证） ---- */
  try {
    const spec = {
      c0: { type: 'lognormal', mean: 100000, cv: 0.25 },
      c1: { type: 'lognormal', mean: 160000, cv: 0.25 },
      e0: { type: 'beta', mean: 3.0, se: 0.1 },
      e1: { type: 'beta', mean: 3.4, se: 0.1 },
      lambda: 100000, n: 500, seed: 42,
    };
    const a = M.PSA(spec);
    const b = M.PSA(spec);
    check('PSA 结果可复现（同种子同结果）', a.probCE === b.probCE, 'probCE=' + a.probCE.toFixed(4));
  } catch (e) {
    check('PSA 结果可复现（同种子同结果）', false, e.message);
  }

  /* ---- 6. 方法学正确性：被支配方案必须被拦截 ---- */
  try {
    const r = await tools.get('calc_icer').execute({
      cost_comparator: 100000, effect_comparator: 3.4,
      cost_intervention: 160000, effect_intervention: 3.0,
      threshold: 100000,
    });
    check('被支配方案被正确拦截', r.meta.costEffective === false && /支配/.test(r.content),
      r.meta.headline || '未判定');
  } catch (e) {
    check('被支配方案被正确拦截', false, e.message);
  }

  /* ---- 7. 会话存储可写 ---- */
  try {
    sessions.save({ id: '__startup_check__', title: '启动自检', messages: [] });
    const back = sessions.get('__startup_check__');
    sessions.remove('__startup_check__');
    check('会话存储可读写', !!back, sessions.dir);
  } catch (e) {
    check('会话存储可读写', false, e.message);
  }

  /* ---- 8. 知识库可被外部覆盖 ---- */
  const customKb = path.join(exeDir, '知识库', 'kb.json');
  check('自定义知识库入口就位', fs.existsSync(path.dirname(customKb)), customKb);

  const passed = items.filter((i) => i.pass).length;
  const failed = items.length - passed;
  return { passed, failed, items, logDir, at: new Date().toISOString() };
}

/** 把自检结果写进轨迹日志（用户报障时可直接转发该文件） */
async function reportStartupCheck(ctx) {
  let result;
  try {
    result = await runStartupCheck(ctx);
  } catch (e) {
    result = { passed: 0, failed: 1, items: [{ name: '自检执行', pass: false, detail: e.message }] };
  }
  try {
    const { TraceLogger } = require('../observability/trace-logger');
    const t = new TraceLogger({ agent: 'startup-check', logDir: ctx.logDir });
    const id = t.start('启动自检');
    for (const it of result.items) {
      if (it.pass) t.ok(id, it.name, { detail: it.detail });
      else t.error(id, it.name, { detail: it.detail });
    }
    t.end(id);
  } catch {
    /* 日志失败不影响启动 */
  }
  return result;
}

module.exports = { runStartupCheck, reportStartupCheck };
