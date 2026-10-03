/**
 * LLM 配置与提供商自动识别
 * 移植自 HelloAgents 框架 core/llm.py + core/llm_adapters.py
 *
 * 设计要点（与 HelloAgents 保持一致）：
 *  1. 基于 OpenAI 原生 API 抽象
 *  2. 三种适配器：OpenAI 兼容 / Anthropic / Gemini
 *  3. 根据 base_url + api_key 格式自动识别 provider
 *  4. 额外提供 OfflineProvider（离线知识引擎），保证零配置即可使用
 */

const fs = require('fs');
const path = require('path');

/** 默认配置 */
const DEFAULTS = {
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  provider: 'auto',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 120000,
};

/**
 * 从 key 格式猜测 provider
 * 与 HelloAgents 的检测逻辑对齐，并针对国内主流服务补充规则
 */
function detectProvider(baseUrl, apiKey) {
  const url = (baseUrl || '').toLowerCase();

  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('googleapis.com') || url.includes('generativelanguage')) return 'gemini';

  // key 前缀特征
  if (/^sk-ant-/.test(apiKey || '')) return 'anthropic';
  if (/^AIza/.test(apiKey || '')) return 'gemini';

  // 国内主流服务（OpenAI 兼容协议）
  if (
    url.includes('deepseek') ||
    url.includes('moonshot') ||
    url.includes('bigmodel') ||
    url.includes('dashscope') ||
    url.includes('modelscope') ||
    url.includes('siliconflow') ||
    url.includes('volcengine') ||
    url.includes('openai.azure')
  ) {
    return 'openai';
  }

  // 本地推理
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')) {
    return 'openai'; // vLLM / Ollama / LM Studio 均为 OpenAI 兼容
  }

  return 'openai';
}

/** LLM 配置类（对应 Python 的 LLMConfig） */
class LLMConfig {
  constructor(opts = {}) {
    const merged = { ...DEFAULTS, ...opts };
    this.model = merged.model;
    this.baseUrl = (merged.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '');
    this.apiKey = merged.apiKey || '';
    this.temperature = merged.temperature;
    this.maxTokens = merged.maxTokens;
    this.timeoutMs = merged.timeoutMs;
    this.provider =
      merged.provider && merged.provider !== 'auto'
        ? merged.provider
        : detectProvider(this.baseUrl, this.apiKey);
  }

  get isOffline() {
    return this.provider === 'offline';
  }

  get isConfigured() {
    return this.provider === 'offline' || !!this.apiKey;
  }

  toJSON() {
    return {
      model: this.model,
      baseUrl: this.baseUrl,
      provider: this.provider,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      hasKey: !!this.apiKey,
    };
  }
}

/**
 * 从用户配置目录持久化读取 LLM 配置
 * 绝不落盘明文以外的信息；API Key 存于 app.getPath('userData')/config.json
 */
function loadLLMConfig(configPath) {
  try {
    if (configPath && fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return new LLMConfig(raw);
    }
  } catch (e) {
    // 配置损坏时退回离线模式，而不是让用户看到崩溃
    console.warn('[LLMConfig] 配置文件读取失败，已退回离线模式:', e.message);
  }
  return new LLMConfig({ provider: 'offline' });
}

function saveLLMConfig(configPath, cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

module.exports = { LLMConfig, DEFAULTS, detectProvider, loadLLMConfig, saveLLMConfig };
