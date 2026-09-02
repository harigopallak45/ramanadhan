// =====================================================================
// Provider-agnostic LLM adapter — the "swappable reasoning engine" socket.
// ---------------------------------------------------------------------
// The audit BRAIN (rubric.js rules + knowledge index + rag.js retrieval +
// scorer.js math) is local and owned. This file is the ONLY part that talks
// to an outside model, and it is interchangeable: flip LLM_PROVIDER in .env
// to route the exact same prompt to a different engine. The model is
// stateless — every call is fed the full context by the brain, so swapping
// providers loses nothing.
//
//   LLM_PROVIDER = groq | openai | anthropic | local
//
// • groq      — OpenAI-compatible. GROQ_API_KEY + GROQ_MODEL.
// • openai    — OpenAI-compatible. OPENAI_API_KEY + OPENAI_MODEL.
// • anthropic — Messages API.      ANTHROPIC_API_KEY + ANTHROPIC_MODEL.
// • local     — OpenAI-compatible local server (Ollama / LM Studio / llama.cpp).
//               LOCAL_LLM_URL + LOCAL_LLM_MODEL. No data leaves the machine.
//
// Public interface (unchanged from the old groq.js):
//   completeJson({ system, user, temperature, maxTokens }) -> parsed JSON
//   isConfigured() -> boolean
//   MODEL    -> resolved model name for the active provider
//   PROVIDER -> active provider id
//   LlmError -> tagged error: kind = auth|timeout|truncated|parse|transport|config
// =====================================================================
const axios = require('axios');

const PROVIDER = (process.env.LLM_PROVIDER || 'groq').toLowerCase().trim();

// Per-provider configuration. Defaults keep the existing Groq .env working
// with no changes (LLM_PROVIDER unset → groq).
const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: process.env.GROQ_API_KEY,
    // Groq retires models on a rolling basis — llama-3.3-70b-versatile was
    // deprecated 2026-06-17 and now 404s ("model does not exist"). Groq's
    // own recommended successor is openai/gpt-oss-120b. If this one is ever
    // retired too, set GROQ_MODEL in the environment rather than editing
    // code; `GET /v1/models` on the Groq API lists what a key can access.
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    style: 'openai',
    keyRequired: true
  },
  openai: {
    url: process.env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    style: 'openai',
    keyRequired: true
  },
  anthropic: {
    url: process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    style: 'anthropic',
    keyRequired: true
  },
  local: {
    // Ollama's OpenAI-compatible endpoint by default; works for LM Studio /
    // llama.cpp server too (point LOCAL_LLM_URL at theirs).
    url: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1/chat/completions',
    apiKey: process.env.LOCAL_LLM_API_KEY || 'not-needed',
    model: process.env.LOCAL_LLM_MODEL || 'llama3.1',
    style: 'openai',
    keyRequired: false // a local server needs no key — reachability is checked at call time
  }
};

const CFG = PROVIDERS[PROVIDER] || null;
const MODEL = CFG ? CFG.model : 'unknown';

// Tagged error so callers can map failure classes to HTTP status codes.
// Named LlmError; groq.js re-exports it as GroqError for backward compatibility.
class LlmError extends Error {
  constructor(message, kind) { super(message); this.name = 'LlmError'; this.kind = kind; }
}

function isConfigured() {
  if (!CFG) return false;
  if (!CFG.keyRequired) return true;      // local: no key needed
  return Boolean(CFG.apiKey);
}

// Models don't always return clean JSON (esp. Anthropic / local without a JSON
// mode). Try a direct parse, then strip ``` fences, then grab the outermost
// {...} block. Keeps the brain tolerant of whichever engine is plugged in.
function extractJson(content) {
  const text = String(content || '').trim();
  if (!text) throw new LlmError('Model returned empty content', 'parse');
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(t.slice(first, last + 1)); } catch (_) { /* fall through */ }
  }
  throw new LlmError(`Model returned non-JSON content: ${text.slice(0, 200)}`, 'parse');
}

function mapTransportError(e, label) {
  if (e instanceof LlmError) return e;
  if (e.code === 'ECONNABORTED') return new LlmError(`${label} request timed out`, 'timeout');
  if (e.code === 'ECONNREFUSED') return new LlmError(`${label} unreachable at ${CFG.url} (is the local model server running?)`, 'transport');
  const status = e.response?.status;
  if (status === 401 || status === 403) return new LlmError(`${label} rejected the API key`, 'auth');
  if (status === 429) return new LlmError(`${label} rate limit hit — try again shortly`, 'timeout');
  const detail = e.response?.data?.error?.message || e.response?.data?.error || e.message;
  return new LlmError(`${label} transport error: ${detail}`, 'transport');
}

// ---- OpenAI-compatible path (groq / openai / local) -------------------------
async function completeOpenAiStyle({ system, user, temperature, maxTokens }) {
  let res;
  try {
    res = await axios.post(
      CFG.url,
      {
        model: CFG.model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      },
      {
        headers: { Authorization: `Bearer ${CFG.apiKey}`, 'Content-Type': 'application/json' },
        timeout: Number(process.env.LLM_TIMEOUT_MS || 60000)
      }
    );
  } catch (e) {
    throw mapTransportError(e, PROVIDER);
  }
  const choice = res.data?.choices?.[0] || {};
  if (choice.finish_reason === 'length') {
    throw new LlmError(`${PROVIDER} response was truncated (raise max_tokens or shorten the prompt)`, 'truncated');
  }
  return extractJson(choice.message?.content || '');
}

// ---- Anthropic Messages API path -------------------------------------------
async function completeAnthropicStyle({ system, user, temperature, maxTokens }) {
  let res;
  try {
    res = await axios.post(
      CFG.url,
      {
        model: CFG.model,
        max_tokens: maxTokens,
        temperature,
        // Anthropic has no response_format flag — instruct JSON and extract it.
        system: `${system}\n\nReturn ONLY the JSON object, with no surrounding prose or markdown fences.`,
        messages: [{ role: 'user', content: user }]
      },
      {
        headers: {
          'x-api-key': CFG.apiKey,
          'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: Number(process.env.LLM_TIMEOUT_MS || 60000)
      }
    );
  } catch (e) {
    throw mapTransportError(e, 'anthropic');
  }
  if (res.data?.stop_reason === 'max_tokens') {
    throw new LlmError('anthropic response was truncated (raise max_tokens or shorten the prompt)', 'truncated');
  }
  const parts = Array.isArray(res.data?.content) ? res.data.content : [];
  const text = parts.map(p => p.text || '').join('').trim();
  return extractJson(text);
}

// Returns the parsed JSON object from the active model. Throws LlmError.
async function completeJson({ system, user, temperature = 0.2, maxTokens = 8000 }) {
  if (!CFG) throw new LlmError(`Unknown LLM_PROVIDER "${PROVIDER}" (use groq|openai|anthropic|local)`, 'config');
  if (!isConfigured()) throw new LlmError(`${PROVIDER} is not configured (API key missing)`, 'auth');
  return CFG.style === 'anthropic'
    ? completeAnthropicStyle({ system, user, temperature, maxTokens })
    : completeOpenAiStyle({ system, user, temperature, maxTokens });
}

module.exports = { completeJson, isConfigured, MODEL, PROVIDER, LlmError };
