/**
 * 工具响应协议（ToolResponse）
 * 移植自 HelloAgents 框架 tools/response.py
 *
 * 统一所有工具的返回结构，让 Agent 主循环无需关心工具内部差异，
 * 同时保证失败也能被模型"看见"并自我修正（而不是直接崩溃）。
 */

class ToolResponse {
  /**
   * @param {string} content  面向 LLM 的文本描述
   * @param {object} meta     结构化元数据，前端可直接消费
   */
  constructor(content, meta = {}) {
    this.content = content;
    this.success = meta.success !== false;
    this.meta = meta;
  }

  static ok(content, meta = {}) {
    return new ToolResponse(content, { ...meta, success: true });
  }

  static fail(content, meta = {}) {
    return new ToolResponse(`[工具执行失败] ${content}`, { ...meta, success: false });
  }

  /** 面向前端的序列化（IPC 传输安全） */
  toJSON() {
    return { content: this.content, success: this.success, meta: this.meta };
  }
}

/**
 * 工具注册表
 * 移植自 HelloAgents 框架 tools/registry.py
 * 支持三种注册方式：函数式 / 标准类 / 描述对象
 */
class ToolRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.tools = new Map();
  }

  /**
   * @param {string|object} tool       工具名 或 工具对象
   * @param {Function|object} [impl]  实现（函数式注册时必填）
   */
  registerTool(tool, impl) {
    let t = tool;
    if (typeof tool === 'string') {
      if (typeof impl !== 'function') {
        throw new Error(`registerTool("${tool}") 需要提供函数实现`);
      }
      t = {
        name: tool,
        description: impl.description || '',
        parameters: parseJSDocParams(impl),
        execute: impl,
      };
    }
    if (!t.name) throw new Error('工具缺少 name');
    if (typeof t.execute !== 'function') throw new Error(`工具 ${t.name} 缺少 execute()`);
    this.tools.set(t.name, t);
    return this;
  }

  /** 批量注册（对应 builtin/ 目录的一组工具） */
  registerAll(tools = []) {
    tools.forEach((t) => this.registerTool(t));
    return this;
  }

  get(name) {
    return this.tools.get(name);
  }

  has(name) {
    return this.tools.has(name);
  }

  list() {
    return [...this.tools.keys()];
  }

  /** 返回可暴露给 LLM 的 function calling 规格 */
  getSpecs(names) {
    const target = names && names.length ? names : this.list();
    return target
      .map((n) => this.tools.get(n))
      .filter(Boolean)
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }

  /** 子代理机制：按白名单过滤可见工具 */
  filter(allow) {
    if (!allow) return this;
    return new ToolRegistryLike(this, new Set(allow));
  }
}

/** 轻量视图，只暴露白名单内的工具（对应 HelloAgents 的 ToolFilter） */
class ToolRegistryLike {
  constructor(parent, allowSet) {
    this.parent = parent;
    this.allowSet = allowSet;
  }
  list() {
    return this.parent.list().filter((n) => this.allowSet.has(n));
  }
  get(name) {
    return this.allowSet.has(name) ? this.parent.get(name) : undefined;
  }
  has(name) {
    return this.allowSet.has(name);
  }
  getSpecs(names) {
    const target = names && names.length ? names : this.list();
    return this.parent.getSpecs(target.filter((n) => this.allowSet.has(n)));
  }
  registerTool() {
    throw new Error('子代理视图不可注册工具');
  }
  registerAll() {
    return this;
  }
}

/**
 * 从 JSDoc 注释解析参数 schema —— 让函数式工具也能被 LLM 正确调用
 * @param {Function} fn
 * @param {Record<string,string>} [hints] 手工补充的参数类型提示
 */
function parseJSDocParams(fn, hints = {}) {
  const src = fn.toString();
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  const doc = m ? m[1] : '';
  const paramNames = [];
  const tagRe = /@param\s+(?:\{[^}]*\})?\s*(\w+)/g;
  let pm;
  while ((pm = tagRe.exec(doc)) !== null) paramNames.push(pm[1]);

  // 显式 schema 优先
  if (fn.parameters) return fn.parameters;

  const properties = {};
  for (const name of paramNames) {
    if (name === 'this') continue;
    const type = hints[name] || guessType(name, doc);
    properties[name] = { type, description: extractParamDoc(doc, name) };
  }
  return { type: 'object', properties, required: Object.keys(properties) };
}

function guessType(name, doc) {
  const re = new RegExp(`@param\\s+\\{([^}]*)\\}\\s*${name}`);
  const m = doc.match(re);
  if (m) {
    const raw = m[1].toLowerCase();
    if (raw.includes('number') || raw.includes('float') || raw.includes('int')) return 'number';
    if (raw.includes('bool')) return 'boolean';
    if (raw.includes('string')) return 'string';
    if (raw.includes('array') || raw.includes('[]')) return 'array';
    if (raw.includes('object')) return 'object';
  }
  return 'string';
}

function extractParamDoc(doc, name) {
  const re = new RegExp(`@param\\s+(?:\\{[^}]*\\})?\\s*${name}\\s+([^*\\n]+)`);
  const m = doc.match(re);
  return m ? m[1].trim() : name;
}

module.exports = { ToolResponse, ToolRegistry, parseJSDocParams };
