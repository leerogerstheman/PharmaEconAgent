#!/usr/bin/env node
/**
 * 知识库构建脚本
 * 把 knowledge/corpus/*.md（含 frontmatter）与 knowledge/data/*.js
 * 合并编译为单一 dist/kb.json，供主进程加载。
 *
 * 零依赖：用 Node 内置模块手写一个最小 YAML frontmatter 解析器。
 * 运行：node scripts/build-knowledge.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'knowledge', 'corpus');
const DATA_DIR = path.join(ROOT, 'knowledge', 'data');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'kb.json');

/** 解析 Markdown frontmatter（支持字符串、数组、数字） */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, content: text.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      // 行内数组 [a, b, c]
      val = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    meta[key] = val;
  }
  return { meta, content: m[2].trim() };
}

function main() {
  if (!fs.existsSync(CORPUS_DIR)) {
    console.error(`[build-knowledge] 找不到语料目录：${CORPUS_DIR}`);
    process.exit(1);
  }

  const topics = require(path.join(DATA_DIR, 'topics.js'));
  const glossary = require(path.join(DATA_DIR, 'glossary.js'));
  const formulas = require(path.join(DATA_DIR, 'formulas.js'));
  const checklists = require(path.join(DATA_DIR, 'checklists.js'));
  const resources = require(path.join(DATA_DIR, 'resources.js'));
  const learningPath = require(path.join(DATA_DIR, 'learning-path.js'));
  const examples = require(path.join(DATA_DIR, 'examples.js'));

  const topicName = Object.fromEntries(topics.map((t) => [t.id, t.name]));
  const chunks = [];
  const errors = [];

  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) {
    const raw = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf-8');
    const { meta, content } = parseFrontmatter(raw);
    if (!meta.id) {
      errors.push(`${f}: 缺少 id`);
      continue;
    }
    if (!meta.topic) {
      errors.push(`${f}: 缺少 topic`);
      continue;
    }
    if (!topicName[meta.topic]) {
      errors.push(`${f}: topic="${meta.topic}" 不在 topics.js 中`);
    }
    const aliases = meta.aliases
      ? (Array.isArray(meta.aliases) ? meta.aliases : String(meta.aliases).split(/[,，]/))
          .map((s) => String(s).trim())
          .filter(Boolean)
      : [];
    const tags = meta.tags
      ? (Array.isArray(meta.tags) ? meta.tags : String(meta.tags).split(/[,，]/))
          .map((s) => String(s).trim())
          .filter(Boolean)
      : [];

    chunks.push({
      id: meta.id,
      title: meta.title || meta.id,
      topic: meta.topic,
      topicName: topicName[meta.topic] || meta.topic,
      type: meta.type || 'concept',
      level: meta.level || 'beginner',
      source: meta.source || '',
      url: meta.url || '',
      year: meta.year || '',
      aliases,
      tags,
      content,
    });
  }

  if (errors.length) {
    console.error('[build-knowledge] 构建失败：');
    errors.forEach((e) => console.error('  ✗ ' + e));
    process.exit(1);
  }

  // 语料按主题顺序排序，阅读体验更连贯
  const topicOrder = Object.fromEntries(topics.map((t, i) => [t.id, t.order || i]));
  chunks.sort((a, b) => (topicOrder[a.topic] || 99) - (topicOrder[b.topic] || 99));

  // 校验 id 唯一
  const ids = new Set();
  for (const c of chunks) {
    if (ids.has(c.id)) {
      console.error(`[build-knowledge] 重复 id：${c.id}`);
      process.exit(1);
    }
    ids.add(c.id);
  }

  const kb = {
    meta: {
      name: '药物经济学知识库',
      version: '1.0.0',
      builtAt: new Date().toISOString(),
      counts: {
        chunks: chunks.length,
        glossary: glossary.length,
        formulas: formulas.length,
        checklists: checklists.length,
        resources: resources.length,
        topics: topics.length,
        examples: examples.length,
        learningSteps: learningPath.length,
      },
      license: '知识条目综合自公开出版物与维基百科（CC BY-SA 4.0）',
    },
    topics,
    chunks,
    glossary,
    formulas,
    checklists,
    resources,
    learningPath,
    examples,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(kb, null, 1), 'utf-8');

  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log('[build-knowledge] 构建完成 ✓');
  console.log(`  条目 ${chunks.length} · 术语 ${glossary.length} · 公式 ${formulas.length}`);
  console.log(`  清单 ${checklists.length} · 资源 ${resources.length} · 示例 ${examples.length} · 学习步骤 ${learningPath.length}`);
  console.log(`  主题 ${topics.length} 个`);
  console.log(`  输出 ${OUT_FILE} (${size} KB)`);
}

main();
