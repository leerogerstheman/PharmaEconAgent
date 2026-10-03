/**
 * Skills 知识外化
 * ---------------------------------------------------------------
 * 移植自 HelloAgents 框架 skills/loader.py
 *
 * 把"怎么做某类分析"这类程序性知识从提示词里搬出来，成为可独立维护的
 * Skill 文件。好处：改流程不用改代码；非开发者也能编辑 Markdown。
 * 每个 Skill 是一个目录，内含 SKILL.md（正文）与 meta（可选）。
 */

const fs = require('fs');
const path = require('path');

class SkillLoader {
  /**
   * @param {string} appRoot  应用根目录
   * @param {KnowledgeBase} kb  知识库（用于回退检索）
   */
  constructor(appRoot, kb) {
    this.roots = [
      path.join(appRoot, 'skills'),
      // 用户可自建 skills 文件夹，放在 exe 旁边
      path.join(path.dirname(require('electron').app.getPath('exe')), 'skills'),
    ];
    this.kb = kb;
    this.cache = new Map();
  }

  /** 扫描并加载所有 Skill */
  loadAll() {
    this.cache.clear();
    for (const root of this.roots) {
      if (!fs.existsSync(root)) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = path.join(root, e.name);
        const file = ['SKILL.md', 'skill.md', 'index.md']
          .map((f) => path.join(dir, f))
          .find((f) => fs.existsSync(f));
        if (!file) continue;
        try {
          const raw = fs.readFileSync(file, 'utf-8');
          const { meta, body } = parseFrontmatter(raw);
          this.cache.set(e.name, {
            id: e.name,
            name: meta.name || e.name,
            description: meta.description || '',
            keywords: String(meta.keywords || '')
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
            whenToUse: meta.when_to_use || meta.whenToUse || '',
            body,
            file,
            userOwned: root !== this.roots[0],
          });
        } catch (err) {
          console.warn(`[skills] 跳过无法解析的技能：${file}`, err.message);
        }
      }
    }
    return this.list();
  }

  list() {
    return [...this.cache.values()].map((s) => ({
      id: s.id, name: s.name, description: s.description,
      whenToUse: s.whenToUse, userOwned: s.userOwned,
    }));
  }

  get(id) {
    return this.cache.get(id) || null;
  }

  /**
   * 根据问题挑选最相关的 Skill
   * 命中关键词即返回，最多返回 1 个（避免提示词膨胀）
   */
  select(question) {
    if (!this.cache.size) this.loadAll();
    const q = String(question || '').toLowerCase();
    if (!q) return null;
    let best = null;
    for (const s of this.cache.values()) {
      let score = 0;
      if (s.name.toLowerCase().includes(q)) score += 5;
      for (const k of s.keywords) {
        if (q.includes(k.toLowerCase())) score += 3;
      }
      if (!best || score > best.score) best = { skill: s, score };
    }
    return best && best.score > 0 ? best.skill : null;
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2].trim() };
}

module.exports = { SkillLoader };
