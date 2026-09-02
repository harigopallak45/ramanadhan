# rag-audit — AI AML/CTF Compliance Analyzer

AI layer for the Centinl AUSTRAC AML/CTF **independent evaluation** portal (aligned
to the AML/CTF Amendment Act 2024 reforms, effective 31 March 2026 — the new
whole-program independent evaluation that replaces the old s.161 Part A review).
Reads an entity's survey answers **and the contents of their uploaded documents**,
grounds its judgement in **your AUSTRAC reference material**, scores each of the
23 evidence areas on adequacy + efficacy against the weighted reform rubric, and
returns a 0–100 score plus a draft findings report for the auditor.

Auto-mounted by `server.js` at `/api/rag-audit` and `/hlgp/api/rag-audit`.

## The pipeline
1. **Intake** — entity answers + uploads via the GHL portal, OR auditor drops files directly.
2. **Read documents** — extract text from PDF / Word / Excel / CSV / txt (`docParser.js`, `evidence.js`).
3. **Ground (RAG)** — retrieve the most relevant AUSTRAC passages per area (`rag.js`).
4. **Score** — LLM grades adequacy/efficacy; JS does all weighting/deductions (`scorer.js`).
5. **Report** — draft findings, copy or log to GHL.

## Endpoints (admin-JWT, bearer header only)
| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/health` | Config + model status |
| POST | `/score/:contactId` | Score an entity from GHL (reads their uploaded docs). `?docs=0` skips doc reading; `?save=1` logs to GHL |
| POST | `/analyze-upload` | multipart `files[]` (+ optional `entityLabel`, `contactId`) → auditor uploads & scores |
| POST | `/note/:contactId` | `{ body }` → append a note to the GHL contact |

## Grounding it on AUSTRAC ("training")
1. Drop your AUSTRAC rules/guidance documents into `knowledge/`.
2. Run `npm run rag:ingest` (rebuilds `knowledge-index.json`).
3. Scoring now retrieves and cites the relevant AUSTRAC rule per area.
Until then, scoring works ungrounded (rubric only). Everything stays local;
only small retrieved snippets go to the model. Uses BM25 lexical retrieval — no
embeddings model, no DB, no extra API key.

## Config (`backend/.env`)

### Reasoning engine (swappable — see `llm.js`)
The brain (rubric + knowledge + retrieval + scoring math) is local and owned;
this only picks the language model it feeds. Switch with one line — the brain
hands any engine identical context. Set `local` to keep all data on-machine.

| Var | Default | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `groq` | `groq` \| `openai` \| `anthropic` \| `local` |
| `LLM_TIMEOUT_MS` | `60000` | per-call timeout |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `openai/gpt-oss-120b` | provider: groq |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-4o-mini` | provider: openai |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-sonnet-4-6` | provider: anthropic |
| `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` | `http://localhost:11434/v1/chat/completions` / `llama3.1` | provider: local (Ollama/LM Studio/llama.cpp) — no key, no data leaves the machine |

### Scoring budget
| Var | Default | Notes |
| --- | --- | --- |
| `GROQ_MAX_TOKENS` | `4000` | output reservation; counts toward Groq TPM |
| `RAG_DOC_CHAR_BUDGET` | `12000` | total document text/prompt (raise on a paid tier) |
| `RAG_GROUND_CHARS` | `500` | AUSTRAC snippet length per area |

**Free Groq tier = 12k tokens/min** (prompt + max_tokens). The defaults keep a
full 23-area score under that. On a paid/Dev tier (or a different provider),
raise `RAG_DOC_CHAR_BUDGET` and `GROQ_MAX_TOKENS` for deeper document analysis.

## Files
`rubric.js` (weighted framework — **tune this**) · `ghl.js` (fetch/enrich/download) ·
`fieldMapper.js` (fields→Q01–Q23) · `docParser.js` (PDF/Word/Excel→text) ·
`evidence.js` (download+parse uploaded files) · `rag.js` + `ingest.js` + `knowledge/`
(AUSTRAC grounding) · `llm.js` (provider-agnostic reasoning adapter — groq/openai/anthropic/local) · `groq.js` (deprecated shim → `llm.js`) · `scorer.js` (prompt/score/report) ·
`routes.js` (router + admin auth + upload).

## Security & limits
Admin-only (bearer header, no `?token=`). Prompt-injection hardened (untrusted
evidence is fenced; the model treats it as data). Secrets (password/token-like
fields & values) are stripped before anything reaches Groq. Scanned/image PDFs
need OCR (not enabled) — use text-based PDFs.
