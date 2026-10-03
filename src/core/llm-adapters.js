/**
 * LLM 适配器
 * 移植自 HelloAgents 框架 core/llm_adapters.py
 *
 * 三种协议适配：OpenAI 兼容 / Anthropic Messages / Google Gemini
 * 统一输入输出（ChatMessage / ToolSpec），屏蔽协议差异。
 * Electron 主进程内置 fetch，无需任何第三方 SDK —— 这是"零安装"的关键。
 */

const { LLMConfig } = require('./llm');

/** 统一的工具规格（与 OpenAI function calling 对齐） */
function toOpenAITools(tools = []) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} },
    },
  }));
}

/** OpenAI 兼容适配器：OpenAI / DeepSeek / Qwen / Kimi / GLM / Ollama / vLLM / LM Studio / ModelScope */
class OpenAIAdapter {
  constructor(config) {
    this.config = config;
    this.name = 'openai';
  }

  async chat({ messages, tools = [], temperature, maxTokens, signal }) {
    const cfg = this.config;
    const body = {
      model: cfg.model,
      messages: messages.map(normalizeOpenAIMessage),
      temperature: temperature ?? cfg.temperature,
      max_tokens: maxTokens ?? cfg.maxTokens,
      stream: false,
    };
    if (tools.length) {
      body.tools = toOpenAITools(tools);
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`OpenAI 兼容接口返回 ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const data = await res.json();
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('模型返回为空');
    const msg = choice.message || {};

    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function && tc.function.name,
      arguments: safeParseJSON((tc.function && tc.function.arguments) || '{}'),
    }));

    return {
      content: msg.content || '',
      reasoning: msg.reasoning_content || msg.reasoning || '',
      toolCalls,
      finishReason: choice.finish_reason,
      usage: data.usage || null,
    };
  }
}

/** Anthropic Messages API 适配器 */
class AnthropicAdapter {
  constructor(config) {
    this.config = config;
    this.name = 'anthropic';
  }

  async chat({ messages, tools = [], temperature, maxTokens, signal }) {
    const cfg = this.config;
    // 拆分 system 与对话消息
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const convo = messages.filter((m) => m.role !== 'system').map(normalizeAnthropicMessage);

    const body = {
      model: cfg.model,
      max_tokens: maxTokens ?? cfg.maxTokens,
      temperature: temperature ?? cfg.temperature,
      messages: convo,
    };
    if (system) body.system = system;
    if (tools.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters || { type: 'object', properties: {} },
      }));
    }

    const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: signal || AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Anthropic 接口返回 ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const data = await res.json();

    const toolCalls = (data.content || [])
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id, name: c.name, arguments: c.input || {} }));

    const text = (data.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    return {
      content: text,
      reasoning: '',
      toolCalls,
      finishReason: data.stop_reason,
      usage: data.usage || null,
    };
  }
}

/** Google Gemini 适配器 */
class GeminiAdapter {
  constructor(config) {
    this.config = config;
    this.name = 'gemini';
  }

  async chat({ messages, tools = [], temperature, maxTokens, signal }) {
    const cfg = this.config;
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }],
      }));

    const payload = {
      contents,
      generationConfig: {
        temperature: temperature ?? cfg.temperature,
        maxOutputTokens: maxTokens ?? cfg.maxTokens,
      },
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    if (tools.length) {
      payload.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: cleanGeminiSchema(t.parameters || {}),
          })),
        },
      ];
    }

    const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(cfg.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Gemini 接口返回 ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const data = await res.json();
    const cand = (data.candidates || [])[0] || {};
    const parts = (cand.content && cand.content.parts) || [];

    const toolCalls = [];
    let text = '';
    for (const p of parts) {
      if (p.text) text += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        });
      }
    }

    return {
      content: text,
      reasoning: '',
      toolCalls,
      finishReason: cand.finishReason,
      usage: data.usageMetadata || null,
    };
  }
}

const ADAPTERS = {
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
  gemini: GeminiAdapter,
};

/** LLM 主入口（对应 Python 的 HelloAgentsLLM） */
class LLM {
  constructor(config) {
    this.config = config instanceof LLMConfig ? config : new LLMConfig(config);
    this.provider = this.config.provider;
    this.adapter = this.provider in ADAPTERS ? new ADAPTERS[this.provider](this.config) : null;
  }

  get available() {
    return !!this.adapter && this.config.isConfigured;
  }

  async chat(params) {
    if (!this.adapter) {
      throw new Error(
        `未配置可用的模型服务（当前 provider=${this.provider}）。请在「设置」中填写 API Key，或使用离线模式。`
      );
    }
    return this.adapter.chat(params);
  }
}

/* ---------------- 消息归一化工具 ---------------- */

function normalizeOpenAIMessage(m) {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: String(m.content ?? '') };
  }
  if (m.role === 'toolResult') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: String(m.content ?? '') };
  }
  const out = { role: m.role, content: m.content ?? '' };
  if (m.toolCalls && m.toolCalls.length) {
    out.tool_calls = m.toolCalls.map((tc, i) => ({
      id: tc.id || `call_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
    }));
  }
  return out;
}

function normalizeAnthropicMessage(m) {
  if (m.role === 'tool' || m.role === 'toolResult') {
    return {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: m.toolCallId, content: String(m.content ?? '') },
      ],
    };
  }
  if (m.toolCalls && m.toolCalls.length) {
    const content = [];
    if (m.content) content.push({ type: 'text', text: m.content });
    for (const tc of m.toolCalls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
    }
    return { role: 'assistant', content };
  }
  return { role: m.role, content: m.content ?? '' };
}

/** Gemini 的 schema 不支持 $schema / additionalProperties，需剥离 */
function cleanGeminiSchema(schema) {
  const s = { ...schema };
  delete s.$schema;
  delete s.additionalProperties;
  if (s.properties) {
    s.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, cleanGeminiSchema(v)])
    );
  }
  return s;
}

function safeParseJSON(text) {
  if (typeof text !== 'string') return text || {};
  try {
    return JSON.parse(text);
  } catch {
    // 部分模型会返回带 markdown 代码块的 JSON
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
    return {};
  }
}

module.exports = { LLM, OpenAIAdapter, AnthropicAdapter, GeminiAdapter, safeParseJSON };
