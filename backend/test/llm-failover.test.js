// Failover behaviour of the LLM adapter: Groq is the primary engine and
// Claude / OpenAI are the backups. A local HTTP server stands in for both
// APIs so nothing here needs a key or the network.
//
//   npm test            (node --test test/)
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const LLM_PATH = path.join(__dirname, '..', 'modules', 'rag-audit', 'llm.js');

// Scriptable fake: `behaviour.groq` / `behaviour.anthropic` / `behaviour.openai`
// is a function (req, body) → { status, headers, json }.
const behaviour = {};
const calls = { groq: 0, anthropic: 0, openai: 0 };
let server, base;

const okOpenAi = (obj, finish = 'stop') => ({ status: 200, json: { choices: [{ finish_reason: finish, message: { content: JSON.stringify(obj) } }] } });
const okAnthropic = (text, stop = 'end_turn') => ({ status: 200, json: { stop_reason: stop, content: [{ type: 'text', text }] } });

before(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const which = req.url.replace(/^\//, '');
      calls[which] += 1;
      const body = raw ? JSON.parse(raw) : {};
      const out = behaviour[which](req, body, calls[which]);
      res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(JSON.stringify(out.json || {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// llm.js reads its configuration at require time — load a fresh copy per
// scenario with the environment we want.
function loadLlm(env) {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (/^(LLM_|GROQ_|OPENAI_|ANTHROPIC_|LOCAL_LLM_)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, {
    LLM_PROVIDER: 'groq',
    GROQ_API_KEY: 'test-groq', GROQ_MODEL: 'openai/gpt-oss-120b',
    ANTHROPIC_API_KEY: 'test-claude', ANTHROPIC_URL: `${base}/anthropic`,
    OPENAI_URL: `${base}/openai`,
    LLM_RETRY_MAX: '1', LLM_RETRY_BASE_MS: '1000', LLM_FAILOVER_RETRIES: '1', LLM_FAILOVER_WAIT_MS: '2000',
    LLM_TIMEOUT_MS: '5000'
  }, env);
  delete require.cache[LLM_PATH];
  const llm = require(LLM_PATH);
  // Groq's URL is fixed in the adapter; point axios at the fake through an
  // interceptor so the request still carries the real headers/body shape.
  const axios = require(path.join(__dirname, '..', 'node_modules', 'axios'));
  axios.interceptors.request.use((cfg) => {
    if (cfg.url === 'https://api.groq.com/openai/v1/chat/completions') cfg.url = `${base}/groq`;
    if (cfg.url === 'https://api.openai.com/v1/chat/completions') cfg.url = `${base}/openai`;
    return cfg;
  });
  process.env = keep;
  return llm;
}

const PROMPT = { system: 'You grade things.', user: 'Grade this.', maxTokens: 500 };
let warnings = [];
const origWarn = console.warn;

beforeEach(() => {
  calls.groq = 0; calls.anthropic = 0; calls.openai = 0;
  behaviour.groq = () => okOpenAi({ from: 'groq' });
  behaviour.anthropic = () => okAnthropic(JSON.stringify({ from: 'claude' }));
  behaviour.openai = () => okOpenAi({ from: 'openai' });
  warnings = [];
  console.warn = (...a) => { warnings.push(a.join(' ')); };
});
after(() => { console.warn = origWarn; });

describe('LLM failover chain (Groq → Claude → OpenAI)', () => {
  test('builds the chain from whichever backups have a key', () => {
    const llm = loadLlm({ OPENAI_API_KEY: 'test-openai' });
    const s = llm.engineStatus();
    assert.equal(s.primary, 'groq');
    assert.deepEqual(s.fallbacks, ['anthropic', 'openai']);
    assert.equal(s.active, 'groq');
    assert.equal(llm.isConfigured(), true);
    assert.equal(llm.getTokenLimit(), 8000); // Groq free-tier assumption until a header says otherwise
    assert.deepEqual(s.chain.map((c) => c.status), ['active', 'standby', 'standby']);

    const explicit = loadLlm({ OPENAI_API_KEY: 'test-openai', LLM_FALLBACK_PROVIDERS: 'openai' });
    assert.deepEqual(explicit.engineStatus().fallbacks, ['openai']);
    const none = loadLlm({ LLM_FALLBACK_PROVIDERS: '' });
    assert.deepEqual(none.engineStatus().fallbacks, []);
  });

  test('a healthy primary serves every call and the backup is never touched', async () => {
    const llm = loadLlm();
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'groq' });
    assert.equal(calls.groq, 1);
    assert.equal(calls.anthropic, 0);
    assert.deepEqual(llm.activeEngine(), { provider: 'groq', model: 'openai/gpt-oss-120b' });
  });

  test('primary down (5xx) → Claude answers the same prompt, and the primary rests for the next calls', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 503, json: { error: { message: 'upstream unavailable' } } });
    let seenSystem = '';
    behaviour.anthropic = (req, body) => { seenSystem = body.system; return okAnthropic(JSON.stringify({ from: 'claude' })); };

    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    assert.equal(calls.groq, 2); // 1 + 1 retry (LLM_FAILOVER_RETRIES=1)
    assert.equal(calls.anthropic, 1);
    assert.match(seenSystem, /You grade things\./);
    assert.match(seenSystem, /Return ONLY the JSON object/);
    assert.deepEqual(llm.activeEngine(), { provider: 'anthropic', model: 'claude-sonnet-5' });

    // second call goes straight to Claude — no retry wait on a resting primary
    await llm.completeJson(PROMPT);
    assert.equal(calls.groq, 2);
    assert.equal(calls.anthropic, 2);
    const s = llm.engineStatus();
    assert.equal(s.active, 'anthropic');
    assert.equal(s.chain[0].status, 'resting');
    assert.ok(s.chain[0].restingUntil);
    assert.match(s.chain[0].lastError, /upstream unavailable/);
    assert.equal(s.chain[0].failed, 1);
    assert.equal(s.chain[1].served, 2);
    // prompt sizing follows the engine that will actually be used
    assert.equal(llm.getTokenLimit(), 0);
    assert.ok(warnings.some((w) => /trying anthropic/.test(w)), warnings.join('\n'));
  });

  test('a long rate-limit wait hands over immediately instead of sleeping', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 429, headers: { 'retry-after': '120', 'x-ratelimit-limit-tokens': '8000' }, json: { error: { message: 'Rate limit reached' } } });
    const t0 = Date.now();
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    assert.ok(Date.now() - t0 < 1500, 'should not have waited for retry-after');
    assert.equal(calls.groq, 1);
    assert.ok(warnings.some((w) => /handing over to the backup/.test(w)));
  });

  test('a short rate-limit wait is honoured before falling back', async () => {
    const llm = loadLlm();
    behaviour.groq = (req, body, n) => n === 1
      ? { status: 429, headers: { 'retry-after': '0' }, json: { error: { message: 'Rate limit reached' } } }
      : okOpenAi({ from: 'groq-after-wait' });
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'groq-after-wait' });
    assert.equal(calls.groq, 2);
    assert.equal(calls.anthropic, 0);
  });

  test('a rejected key fails over and rests the primary', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 401, json: { error: { message: 'Invalid API Key' } } });
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    assert.equal(calls.groq, 1);
    assert.equal(llm.engineStatus().chain[0].status, 'resting');
  });

  test('a request Groq calls too large goes to Claude whole', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 413, json: { error: { message: 'Request too large for model. Limit 8000, Requested 9100' } } });
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    // per-prompt problem: the primary is not rested, and its cap was learnt
    assert.equal(llm.engineStatus().chain[0].status, 'active');
    assert.equal(llm.getTokenLimit(), 8000);
  });

  test('truncated or non-JSON answers fall back for that call only', async () => {
    const llm = loadLlm();
    behaviour.groq = () => okOpenAi({ partial: true }, 'length');
    let out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    assert.equal(calls.groq, 2); // one ×1.5 retry before giving the call away
    assert.equal(llm.engineStatus().chain[0].status, 'active');

    calls.groq = 0;
    behaviour.groq = () => ({ status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: 'Sorry, I cannot.' } }] } });
    out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'claude' });
    assert.equal(calls.groq, 1);
  });

  test('Claude answers wrapped in a code fence are still parsed', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 500, json: {} });
    behaviour.anthropic = () => okAnthropic('```json\n{"from":"claude","fenced":true}\n```');
    assert.deepEqual(await llm.completeJson(PROMPT), { from: 'claude', fenced: true });
  });

  test('the chain continues to OpenAI when Claude fails too', async () => {
    const llm = loadLlm({ OPENAI_API_KEY: 'test-openai' });
    behaviour.groq = () => ({ status: 500, json: {} });
    behaviour.anthropic = () => ({ status: 529, json: { error: { message: 'Overloaded' } } });
    const out = await llm.completeJson(PROMPT);
    assert.deepEqual(out, { from: 'openai' });
    assert.equal(llm.activeEngine().provider, 'openai');
    assert.deepEqual(llm.engineStatus().chain.map((c) => c.status), ['resting', 'resting', 'active']);
  });

  test('when every engine fails the error names the chain and keeps the last kind', async () => {
    const llm = loadLlm();
    behaviour.groq = () => ({ status: 500, json: { error: { message: 'groq broke' } } });
    behaviour.anthropic = () => ({ status: 401, json: { error: { message: 'bad claude key' } } });
    await assert.rejects(llm.completeJson(PROMPT), (e) => {
      assert.equal(e.name, 'LlmError');
      assert.equal(e.kind, 'auth');
      assert.match(e.message, /All engines failed/);
      assert.match(e.message, /anthropic rejected the API key/);
      return true;
    });
    // resting engines are still tried as a last resort on the next call
    behaviour.groq = () => okOpenAi({ from: 'groq-recovered' });
    assert.deepEqual(await llm.completeJson(PROMPT), { from: 'groq-recovered' });
    assert.equal(llm.engineStatus().chain[0].status, 'active');
  });

  test('with no backup configured the primary keeps its full retry budget and its own error', async () => {
    const llm = loadLlm({ LLM_FALLBACK_PROVIDERS: '', LLM_RETRY_MAX: '2', LLM_RETRY_BASE_MS: '1000' });
    behaviour.groq = () => ({ status: 429, headers: { 'retry-after': '0' }, json: { error: { message: 'Rate limit reached' } } });
    await assert.rejects(llm.completeJson(PROMPT), (e) => {
      assert.equal(e.kind, 'timeout');
      assert.doesNotMatch(e.message, /All engines/);
      return true;
    });
    assert.equal(calls.groq, 3); // 1 + LLM_RETRY_MAX retries
    assert.equal(calls.anthropic, 0);
  });

  test('a primary without a key hands everything to the first configured backup', async () => {
    const llm = loadLlm({ GROQ_API_KEY: '' });
    assert.equal(llm.isConfigured(), true);
    assert.equal(llm.engineStatus().active, 'anthropic');
    assert.deepEqual(await llm.completeJson(PROMPT), { from: 'claude' });
    assert.equal(calls.groq, 0);
    const nothing = loadLlm({ GROQ_API_KEY: '', ANTHROPIC_API_KEY: '' });
    assert.equal(nothing.isConfigured(), false);
    await assert.rejects(nothing.completeJson(PROMPT), (e) => e.kind === 'auth');
  });
});
