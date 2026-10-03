/**
 * 会话持久化（SessionStore）
 * ---------------------------------------------------------------
 * 移植自 HelloAgents 框架 core/session_store.py
 *
 * 用 JSON 文件而非 SQLite：这是"零安装"的关键约束之一 ——
 * 用户电脑上不允许出现任何需要额外安装的数据库依赖。
 * 单个会话一个文件，天然并发安全，损坏时按文件隔离而非整体失败。
 */

const fs = require('fs');
const path = require('path');

class SessionStore {
  constructor(dir) {
    this.dir = dir;
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  }

  _file(id) {
    // id 可能来自外部，做一次安全过滤，避免路径穿越
    const safe = String(id).replace(/[^\w\-]/g, '_').slice(0, 64);
    return path.join(this.dir, `${safe}.json`);
  }

  list() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8'));
            return {
              id: d.id,
              title: d.title || '未命名对话',
              createdAt: d.createdAt || 0,
              updatedAt: d.updatedAt || 0,
              messageCount: (d.messages || []).length,
            };
          } catch {
            // 单个文件损坏不影响其他会话
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  get(id) {
    try {
      const f = this._file(id);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch {
      return null;
    }
  }

  save(data) {
    const now = Date.now();
    const prev = this.get(data.id) || {};
    const record = {
      id: data.id,
      title: data.title || prev.title || '未命名对话',
      createdAt: prev.createdAt || now,
      updatedAt: now,
      messages: data.messages || prev.messages || [],
    };
    const f = this._file(data.id);
    // 先写临时文件再重命名，避免写入中途断电导致文件损坏
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 1), 'utf-8');
    fs.renameSync(tmp, f);
    return record;
  }

  remove(id) {
    try {
      const f = this._file(id);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      return true;
    } catch {
      return false;
    }
  }

  clearAll() {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (f.endsWith('.json')) fs.unlinkSync(path.join(this.dir, f));
      }
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { SessionStore };
