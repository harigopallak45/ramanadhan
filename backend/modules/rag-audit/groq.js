// =====================================================================
// Minimal Groq client (OpenAI-compatible chat completions) using axios,
// to stay consistent with the rest of the backend. Uses JSON mode so the
// model returns strict JSON we can parse without scraping prose.
// =====================================================================
const axios = require('axios');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Tagged error so callers can map failure classes to HTTP status codes.
class GroqError extends Error {
  constructor(message, kind) { super(message); this.name = 'GroqError'; this.kind = kind; }
}

function isConfigured() {
  return Boolean(GROQ_API_KEY);
}

// Returns the parsed JSON object from the model. Throws a GroqError with a
// `kind` of 'auth' | 'timeout' | 'truncated' | 'parse' | 'transport'.
async function completeJson({ system, user, temperature = 0.2, maxTokens = 8000 }) {
  if (!GROQ_API_KEY) throw new GroqError('GROQ_API_KEY is not set', 'auth');

  let res;
  try {
    res = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      },
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
  } catch (e) {
    if (e.code === 'ECONNABORTED') throw new GroqError('Groq request timed out', 'timeout');
    if (e.response?.status === 401) throw new GroqError('Groq rejected the API key', 'auth');
    if (e.response?.status === 429) throw new GroqError('Groq rate limit hit — try again shortly', 'timeout');
    throw new GroqError(`Groq transport error: ${e.response?.data?.error?.message || e.message}`, 'transport');
  }

  const choice = res.data?.choices?.[0] || {};
  const content = choice.message?.content || '';

  // If the model hit the token ceiling the JSON is almost certainly cut off.
  if (choice.finish_reason === 'length') {
    throw new GroqError('Groq response was truncated (raise GROQ max_tokens or shorten the prompt)', 'truncated');
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new GroqError(`Groq returned non-JSON content: ${content.slice(0, 200)}`, 'parse');
  }
}

module.exports = { completeJson, isConfigured, GROQ_MODEL, GroqError };
