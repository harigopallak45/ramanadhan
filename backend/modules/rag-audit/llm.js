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
//   LLM_PROVIDER = groq | openai | anthropic | local          (primary)
//   LLM_FALLBACK_PROVIDERS = anthropic,openai                 (backups, in order)
//
// • groq      — OpenAI-compatible. GROQ_API_KEY + GROQ_MODEL.
// • openai    — OpenAI-compatible. OPENAI_API_KEY + OPENAI_MODEL.
// • anthropic — Messages API.      ANTHROPIC_API_KEY + ANTHROPIC_MODEL.
// • local     — OpenAI-compatible local server (Ollama / LM Studio / llama.cpp).
//               LOCAL_LLM_URL + LOCAL_LLM_MODEL. No data leaves the machine.
//
// Failover: every call goes to the primary first. If the primary is down,
// rejects the key, is rate-limited beyond a short wait, or returns something
// unusable (truncated / non-JSON), the SAME prompt is sent to the next
// configured backup, and so on down the chain. A provider that failed on
// an outage-type error is rested for LLM_FAILOVER_COOLDOWN_MS so a
// multi-call job doesn't re-pay the retry wait on every call; it is tried
// again once the cooldown lapses (or straight away if nothing else is
// left). With no LLM_FALLBACK_PROVIDERS set, every OTHER provider that has
// an API key becomes a backup, in the order anthropic → openai → groq.
//
// Public interface:
//   completeJson({ system, user, temperature, maxTokens }) -> parsed JSON
//   isConfigured() -> boolean   (some provider in the chain has a key)
//   MODEL / PROVIDER -> the PRIMARY engine (kept for existing callers)
//   activeEngine() -> { provider, model } that will serve / last served a call
//   engineStatus() -> chain view for the health endpoint
//   getTokenLimit() -> per-minute token cap of the engine about to be used
//   LlmError -> tagged error: kind = auth|timeout|truncated|parse|transport|config|too_large
// =====================================================================
const axios = require('axios');

// Settings whose values can never legally contain a space — provider ids and
// model names. Older dotenv versions don't strip a trailing `# comment`, so a
// line copied from .env.example as `LLM_PROVIDER=groq   # groq | openai | …`
// yields the whole string, PROVIDERS[PROVIDER] misses, and the entire engine
// silently reports "not configured" with a perfectly good API key sitting
// right there. Cut at the first whitespace and drop surrounding quotes.
function envWord(name, fallback = '') {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const cleaned = String(raw).trim().replace(/^['"]|['"]$/g, '').split(/\s+/)[0];
  return cleaned || fallback;
}

const PROVIDER = envWord('LLM_PROVIDER', 'groq').toLowerCase();

// Per-provider configuration. Defaults keep the existing Groq .env working
// with no changes (LLM_PROVIDER unset → groq).
const PROVIDERS = {
  groq: {
    id: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: process.env.GROQ_API_KEY,
    // Groq retires models on a rolling basis — llama-3.3-70b-versatile was
    // deprecated 2026-06-17 and now 404s ("model does not exist"). Groq's
    // own recommended successor is openai/gpt-oss-120b. If this one is ever
    // retired too, set GROQ_MODEL in the environment rather than editing
    // code; `GET /v1/models` on the Groq API lists what a key can access.
    model: envWord('GROQ_MODEL') || 'openai/gpt-oss-120b',
    style: 'openai',
    keyRequired: true,
    // Groq's free tier meters 8k tokens/minute for gpt-oss-120b; assume
    // that until a response header says otherwise so the first call is
    // sized safely (a paid key simply reports a bigger number).
    defaultTokenLimit: 8000
  },
  openai: {
    id: 'openai',
    url: process.env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY,
    model: envWord('OPENAI_MODEL') || 'gpt-4o-mini',
    style: 'openai',
    keyRequired: true,
    defaultTokenLimit: 0
  },
  anthropic: {
    id: 'anthropic',
    url: process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: envWord('ANTHROPIC_MODEL') || 'claude-sonnet-5',
    style: 'anthropic',
    keyRequired: true,
    defaultTokenLimit: 0
  },
  local: {
    id: 'local',
    // Ollama's OpenAI-compatible endpoint by default; works for LM Studio /
    // llama.cpp server too (point LOCAL_LLM_URL at theirs).
    url: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1/chat/completions',
    apiKey: process.env.LOCAL_LLM_API_KEY || 'not-needed',
    model: envWord('LOCAL_LLM_MODEL') || 'llama3.1',
    style: 'openai',
    keyRequired: false, // a local server needs no key — reachability is checked at call time
    defaultTokenLimit: 0
  }
};

const CFG = PROVIDERS[PROVIDER] || null;
const MODEL = CFG ? CFG.model : 'unknown';

// Tagged error so callers can map failure classes to HTTP status codes.
// Named LlmError; groq.js re-exports it as GroqError for backward compatibility.
class LlmError extends Error {
  constructor(message, kind) { super(message); this.name = 'LlmError'; this.kind = kind; }
}

function providerConfigured(cfg) {
  if (!cfg) return false;
  if (!cfg.keyRequired) return true;      // local: no key needed
  return Boolean(cfg.apiKey);
}

// ---- The failover chain ---------------------------------------------------
// Primary first, then the backups. Unknown names are ignored; the primary
// is never listed twice. `local` is only a backup when named explicitly —
// an unreachable localhost server is not a useful default backup.
function parseList(v) {
  return String(v || '').split(/[,\s]+/).map(s => s.toLowerCase().trim()).filter(Boolean);
}
const FALLBACK_ENV = process.env.LLM_FALLBACK_PROVIDERS;
const FALLBACKS = (FALLBACK_ENV !== undefined
  ? parseList(FALLBACK_ENV)
  : ['anthropic', 'openai', 'groq'].filter(p => PROVIDERS[p].keyRequired && PROVIDERS[p].apiKey)
).filter(p => PROVIDERS[p] && p !== PROVIDER);
const CHAIN = CFG ? [PROVIDER, ...new Set(FALLBACKS)] : [];

// Runtime state per provider: the learnt token cap, and when it was last
// rested after an outage-type failure.
const state = {};
for (const id of Object.keys(PROVIDERS)) {
  state[id] = { tokenLimit: 0, downUntil: 0, lastError: '', lastErrorAt: 0, served: 0, failed: 0 };
}
let lastServed = ''; // provider id that completed the most recent call

function isConfigured() { return CHAIN.some(id => providerConfigured(PROVIDERS[id])); }

// Human-readable reason the engine can't serve a call, or '' when it can.
// "AI not set up" on its own sent us hunting through .env by hand; this names
// the actual cause so the dashboard and the 503s can repeat it verbatim.
function configProblem() {
  if (!CFG) {
    return `LLM_PROVIDER is "${PROVIDER}", which is not one of: ${Object.keys(PROVIDERS).join(', ')}.`;
  }
  if (!isConfigured()) {
    const needed = CHAIN.map(id => `${id.toUpperCase()}_API_KEY`).join(' or ');
    return `No API key set for the configured engine${CHAIN.length > 1 ? 's' : ''} (${CHAIN.join(', ')}) — set ${needed}.`;
  }
  return '';
}

if (configProblem()) {
  console.warn(`[LLM] AI scoring is disabled: ${configProblem()}`);
}

const FAILOVER_COOLDOWN_MS = Math.max(0, parseInt(process.env.LLM_FAILOVER_COOLDOWN_MS || '300000', 10)); // 5 min
const FAILOVER_AUTH_COOLDOWN_MS = Math.max(FAILOVER_COOLDOWN_MS, 30 * 60 * 1000); // a rejected key won't fix itself soon

function resting(id) { return state[id].downUntil > Date.now(); }

// Providers in the order a call will try them: configured ones that are not
// resting first (chain order), then the resting ones as a last resort.
function candidateOrder() {
  const configured = CHAIN.filter(id => providerConfigured(PROVIDERS[id]));
  return [...configured.filter(id => !resting(id)), ...configured.filter(id => resting(id))];
}

function activeProviderId() { return candidateOrder()[0] || PROVIDER; }

// The engine that will serve the next call — or, right after a call, the
// one that served it. Callers stamp this on scores and reports.
function activeEngine() {
  const id = lastServed && providerConfigured(PROVIDERS[lastServed]) && !resting(lastServed) ? lastServed : activeProviderId();
  const cfg = PROVIDERS[id] || CFG;
  return { provider: id, model: cfg ? cfg.model : 'unknown' };
}

// Chain view for the health endpoint / dashboard chip.
function engineStatus() {
  const active = activeProviderId();
  return {
    primary: PROVIDER,
    problem: configProblem(),
    fallbacks: CHAIN.slice(1),
    active,
    activeModel: (PROVIDERS[active] || CFG || {}).model || 'unknown',
    chain: CHAIN.map(id => {
      const cfg = PROVIDERS[id];
      const s = state[id];
      const configured = providerConfigured(cfg);
      return {
        provider: id,
        model: cfg.model,
        configured,
        role: id === PROVIDER ? 'primary' : 'backup',
        status: !configured ? 'not configured' : resting(id) ? 'resting' : id === active ? 'active' : 'standby',
        restingUntil: resting(id) ? new Date(s.downUntil).toISOString() : null,
        lastError: s.lastError || null,
        served: s.served,
        failed: s.failed
      };
    })
  };
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

function mapTransportError(e, cfg) {
  if (e instanceof LlmError) return e;
  const label = cfg.id;
  if (e.code === 'ECONNABORTED') return new LlmError(`${label} request timed out`, 'timeout');
  if (e.code === 'ECONNREFUSED') return new LlmError(`${label} unreachable at ${cfg.url} (is the model server running?)`, 'transport');
  const status = e.response?.status;
  if (status === 401 || status === 403) return new LlmError(`${label} rejected the API key`, 'auth');
  if (status === 429) return new LlmError(`${label} rate limit hit — try again shortly`, 'timeout');
  const detail = e.response?.data?.error?.message || e.response?.data?.error || e.message;
  // Groq refuses outright (413) when prompt + max_tokens exceeds the key's
  // per-minute token limit — "Request too large … Limit 8000, Requested
  // 8393". Callers that build big prompts (the report writer) shrink and
  // retry on this, so tag it and carry the numbers.
  if (status === 413 || /request too large/i.test(String(detail))) {
    const err = new LlmError(`${label} refused the request as too large: ${detail}`, 'too_large');
    const m = String(detail).match(/Limit\s+(\d+).*?Requested\s+(\d+)/i);
    if (m) { err.limit = Number(m[1]); err.requested = Number(m[2]); noteTokenLimit(cfg, err.limit); }
    return err;
  }
  return new LlmError(`${label} transport error: ${detail}`, 'transport');
}

// ---- Token budget awareness -------------------------------------------------
// Providers that meter tokens per minute (Groq) reject a single request that
// would exceed the limit on its own, so prompt builders need to know how
// big they may go. The limit is learnt from the x-ratelimit-limit-tokens
// header of any response (LLM_TPM_LIMIT overrides the PRIMARY's cap; 0 =
// no cap known). Each provider keeps its own figure, and getTokenLimit()
// reports the one for the engine the next call will actually use — so a
// prompt sized while Groq is resting may grow to what Claude accepts.
const CHARS_PER_TOKEN = 3.5; // conservative for English prose + JSON
const ENV_TOKEN_LIMIT = parseInt(process.env.LLM_TPM_LIMIT || '0', 10) || 0;
function noteTokenLimit(cfg, n) {
  if (ENV_TOKEN_LIMIT && cfg.id === PROVIDER) return; // explicit config wins
  const v = Number(n);
  if (Number.isFinite(v) && v > 0) state[cfg.id].tokenLimit = v;
}
function noteHeaders(cfg, headers) {
  if (headers && headers['x-ratelimit-limit-tokens']) noteTokenLimit(cfg, headers['x-ratelimit-limit-tokens']);
}
function tokenLimitFor(id) {
  if (id === PROVIDER && ENV_TOKEN_LIMIT) return ENV_TOKEN_LIMIT;
  const cfg = PROVIDERS[id];
  return state[id].tokenLimit || (cfg ? cfg.defaultTokenLimit : 0);
}
// 0 means "no known cap" — callers should treat that as effectively unlimited.
function getTokenLimit() { return tokenLimitFor(activeProviderId()); }
function estimateTokens(text) { return Math.ceil(String(text || '').length / CHARS_PER_TOKEN); }

// ---- Rate-limit / transient-failure retry ----------------------------------
// The formal report is built from several back-to-back calls, and Groq's
// free tier meters prompt+output tokens per minute — the 3rd or 4th call in
// a burst routinely gets a 429. Rather than fail a multi-minute report on a
// transient limit, wait (honouring the server's retry-after when it sends
// one) and retry a bounded number of times. Auth, parse and truncation
// errors are never retried — they won't fix themselves.
//
// When a backup engine is configured the wait is capped: a retry-after
// longer than LLM_FAILOVER_WAIT_MS (or more than LLM_FAILOVER_RETRIES
// attempts) hands the call to the backup instead of sitting on it.
const RETRY_MAX = Math.max(0, parseInt(process.env.LLM_RETRY_MAX || '4', 10));
const RETRY_BASE_MS = Math.max(1000, parseInt(process.env.LLM_RETRY_BASE_MS || '15000', 10));
const FAILOVER_WAIT_MS = Math.max(0, parseInt(process.env.LLM_FAILOVER_WAIT_MS || '20000', 10));
const FAILOVER_RETRIES = Math.max(0, parseInt(process.env.LLM_FAILOVER_RETRIES || '2', 10));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function retryDelayMs(e, attempt) {
  const status = e?.response?.status;
  if (status !== 429 && !(status >= 500 && status < 600) && e?.code !== 'ECONNRESET') return -1;
  // Groq's token bucket refills continuously and its retry-after says
  // exactly how long until the request fits — trust it (plus a margin)
  // rather than over-waiting on a blind backoff.
  const hdr = e.response?.headers?.['retry-after'];
  const hinted = hdr ? Number(hdr) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted >= 0) return Math.min(120000, hinted + 750);
  return Math.min(120000, RETRY_BASE_MS * Math.pow(2, attempt)); // 15s, 30s, 60s …
}

async function postWithRetry(doPost, cfg, canFailOver) {
  const maxAttempts = canFailOver ? Math.min(RETRY_MAX, FAILOVER_RETRIES) : RETRY_MAX;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await doPost();
      noteHeaders(cfg, res.headers);
      return res;
    } catch (e) {
      noteHeaders(cfg, e.response?.headers);
      const delay = retryDelayMs(e, attempt);
      if (delay < 0 || attempt >= maxAttempts) throw mapTransportError(e, cfg);
      if (canFailOver && delay > FAILOVER_WAIT_MS) {
        console.warn(`[rag-audit llm] ${cfg.id} returned ${e.response?.status || e.code} asking for a ${Math.round(delay / 1000)}s wait; handing over to the backup engine instead`);
        throw mapTransportError(e, cfg);
      }
      console.warn(`[rag-audit llm] ${cfg.id} returned ${e.response?.status || e.code}; retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(delay);
    }
  }
}

// Hosted frontier models write long JSON slower than Groq's LPUs — give
// them longer unless LLM_TIMEOUT_MS pins a figure.
function timeoutFor(cfg) {
  if (process.env.LLM_TIMEOUT_MS) return Number(process.env.LLM_TIMEOUT_MS);
  return cfg.id === 'groq' ? 60000 : 180000;
}

// ---- Reasoning models ------------------------------------------------------
// gpt-oss (Groq's current default), OpenAI's o-series/gpt-5 and similar
// "think first" models spend hidden reasoning tokens that COUNT AGAINST
// max_tokens — at the default effort a 23-area scoring call can burn most
// of its budget before writing a byte of JSON and come back truncated.
// Cap the effort for those models (LLM_REASONING_EFFORT: low | medium |
// high, or "none" to send nothing). Non-reasoning models reject the
// parameter, so it is only sent where the model name says it applies.
const REASONING_MODEL_RE = /gpt-oss|(^|\/)o[1-9](-|$)|gpt-5|deepseek-r1|qwen-?3|reasoning|think/i;
const REASONING_EFFORT = (process.env.LLM_REASONING_EFFORT || 'low').toLowerCase().trim();
function reasoningParams(cfg) {
  if (!REASONING_MODEL_RE.test(cfg.model) || REASONING_EFFORT === 'none' || REASONING_EFFORT === '') return {};
  return { reasoning_effort: REASONING_EFFORT };
}

// ---- OpenAI-compatible path (groq / openai / local) -------------------------
async function completeOpenAiStyle(cfg, { system, user, temperature, maxTokens }, canFailOver, _retried = false) {
  const res = await postWithRetry(() => axios.post(
    cfg.url,
    {
      model: cfg.model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...reasoningParams(cfg),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      timeout: timeoutFor(cfg)
    }
  ), cfg, canFailOver);
  const choice = res.data?.choices?.[0] || {};
  if (choice.finish_reason === 'length') {
    // One more try with half again the budget before giving up — a
    // truncated JSON document is worthless, a slightly larger call is not.
    if (!_retried) {
      console.warn(`[rag-audit llm] ${cfg.id} truncated at ${maxTokens} tokens; retrying once at ${Math.round(maxTokens * 1.5)}`);
      return completeOpenAiStyle(cfg, { system, user, temperature, maxTokens: Math.round(maxTokens * 1.5) }, canFailOver, true);
    }
    throw new LlmError(`${cfg.id} response was truncated (raise max_tokens or shorten the prompt)`, 'truncated');
  }
  return extractJson(choice.message?.content || '');
}

// ---- Anthropic Messages API path -------------------------------------------
async function completeAnthropicStyle(cfg, { system, user, temperature, maxTokens }, canFailOver, _retried = false) {
  const res = await postWithRetry(() => axios.post(
    cfg.url,
    {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      // Anthropic has no response_format flag — instruct JSON and extract it.
      system: `${system}\n\nReturn ONLY the JSON object, with no surrounding prose or markdown fences.`,
      messages: [{ role: 'user', content: user }]
    },
    {
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
        'Content-Type': 'application/json'
      },
      timeout: timeoutFor(cfg)
    }
  ), cfg, canFailOver);
  if (res.data?.stop_reason === 'max_tokens') {
    if (!_retried) {
      console.warn(`[rag-audit llm] ${cfg.id} truncated at ${maxTokens} tokens; retrying once at ${Math.round(maxTokens * 1.5)}`);
      return completeAnthropicStyle(cfg, { system, user, temperature, maxTokens: Math.round(maxTokens * 1.5) }, canFailOver, true);
    }
    throw new LlmError(`${cfg.id} response was truncated (raise max_tokens or shorten the prompt)`, 'truncated');
  }
  const parts = Array.isArray(res.data?.content) ? res.data.content : [];
  const text = parts.map(p => p.text || '').join('').trim();
  return extractJson(text);
}

function callProvider(cfg, opts, canFailOver) {
  return cfg.style === 'anthropic'
    ? completeAnthropicStyle(cfg, opts, canFailOver)
    : completeOpenAiStyle(cfg, opts, canFailOver);
}

// Outage-type failures rest the provider so the rest of the job goes
// straight to the backup. A too-large / truncated / non-JSON answer is a
// property of this one prompt, not of the provider — try the backup for
// this call, but keep the provider first in line for the next one.
function restAfter(e) {
  if (e.kind === 'auth') return FAILOVER_AUTH_COOLDOWN_MS;
  if (e.kind === 'timeout' || e.kind === 'transport') return FAILOVER_COOLDOWN_MS;
  return 0;
}

// Returns the parsed JSON object from the first engine in the chain that
// can answer. Throws the LAST provider's LlmError when all of them fail.
async function completeJson({ system, user, temperature = 0.2, maxTokens = 8000 }) {
  if (!CFG) throw new LlmError(`Unknown LLM_PROVIDER "${PROVIDER}" (use groq|openai|anthropic|local)`, 'config');
  const order = candidateOrder();
  if (!order.length) throw new LlmError(`${PROVIDER} is not configured (API key missing)`, 'auth');
  const opts = { system, user, temperature, maxTokens };
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    const cfg = PROVIDERS[order[i]];
    const canFailOver = i < order.length - 1;
    try {
      const out = await callProvider(cfg, opts, canFailOver);
      state[cfg.id].downUntil = 0;
      state[cfg.id].served += 1;
      if (lastServed && lastServed !== cfg.id) console.warn(`[rag-audit llm] ${cfg.id} served the call (${order[0]} unavailable)`);
      lastServed = cfg.id;
      return out;
    } catch (e) {
      const err = e instanceof LlmError ? e : mapTransportError(e, cfg);
      lastErr = err;
      state[cfg.id].failed += 1;
      state[cfg.id].lastError = err.message;
      state[cfg.id].lastErrorAt = Date.now();
      const rest = restAfter(err);
      if (rest) state[cfg.id].downUntil = Date.now() + rest;
      if (!canFailOver) break;
      console.warn(`[rag-audit llm] ${cfg.id} failed (${err.kind}: ${err.message}); trying ${order[i + 1]}`);
    }
  }
  if (order.length > 1) {
    const chained = new LlmError(`All engines failed — last: ${lastErr.message}`, lastErr.kind);
    Object.assign(chained, { limit: lastErr.limit, requested: lastErr.requested });
    throw chained;
  }
  throw lastErr;
}

module.exports = {
  completeJson, isConfigured, configProblem, MODEL, PROVIDER, LlmError,
  activeEngine, engineStatus, getTokenLimit, estimateTokens, CHARS_PER_TOKEN
};
