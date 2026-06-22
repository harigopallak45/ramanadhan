// =====================================================================
// DEPRECATED SHIM — kept for backward compatibility only.
// The LLM layer is now provider-agnostic; see llm.js. This file re-exports
// the adapter under the old names so any lingering `require('./groq')` keeps
// working. New code should require('./llm') directly.
//   GROQ_MODEL  → MODEL (resolved model for the ACTIVE provider)
//   GroqError   → LlmError (same class, so `instanceof` checks still pass)
// =====================================================================
const { completeJson, isConfigured, MODEL, PROVIDER, LlmError } = require('./llm');

module.exports = {
  completeJson,
  isConfigured,
  GROQ_MODEL: MODEL,
  PROVIDER,
  GroqError: LlmError
};
