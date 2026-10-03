/**
 * 可观测性：TraceLogger
 * 移植自 HelloAgents 框架 observability/trace_logger.py
 *
 * 记录每次 Agent 执行的完整轨迹，写入 userData/logs/trace-YYYY-MM-DD.jsonl。
 * 用途：学生遇到问题时能把日志发给老师/开发者；也便于自查工具调用是否正确。
 */

const fs = require('fs');
const path = require('path');

class TraceLogger {
  constructor(opts = {}) {
    this.agent = opts.agent || 'agent';
    this.console = !!opts.console;
    this.logDir = opts.logDir || null;
    this.buffer = [];
    this.enabled = opts.enabled !== false;
  }

  _line(type, msg, data) {
    const rec = {
      ts: new Date().toISOString(),
      agent: this.agent,
      type,
      msg,
      ...(data ? { data } : {}),
    };
    this.buffer.push(rec);
    if (this.buffer.length > 500) this.buffer.splice(0, 200);
    if (this.console) console.log(`[trace:${type}] ${msg}`);
    if (this.logDir) this._append(rec);
    return rec;
  }

  _append(rec) {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const file = path.join(this.logDir, `trace-${new Date().toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8');
    } catch {
      // 日志失败绝不能影响主流程
    }
  }

  start(task) {
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this._line('start', '任务开始', { traceId: id, task: String(task).slice(0, 300) });
    return id;
  }

  tool(traceId, stepRecord) {
    this._line('tool', '工具调用', {
      traceId,
      step: stepRecord.step,
      calls: stepRecord.toolCalls.map((c) => ({
        name: c.name,
        args: c.arguments,
        ok: stepRecord.results.find((r) => r.call.id === c.id)?.response.success,
      })),
    });
  }

  ok(traceId, msg, data) {
    return this._line('ok', msg, { traceId, ...data });
  }

  warn(traceId, msg, data) {
    return this._line('warn', msg, { traceId, ...data });
  }

  error(traceId, msg, data) {
    return this._line('error', msg, { traceId, ...data });
  }

  end(traceId) {
    return this._line('end', '任务结束', { traceId });
  }

  /** 导出最近轨迹（供"查看日志"功能） */
  recent(n = 50) {
    return this.buffer.slice(-n);
  }
}

module.exports = { TraceLogger };
