# rag-audit — AI AML/CTF Compliance Analyzer

AI layer for the Centinl AUSTRAC AML/CTF s.161 independent review portal.
Reads an entity's survey answers **and the contents of their uploaded documents**,
grounds its judgement in **your AUSTRAC reference material**, scores each of the
23 review areas on adequacy + efficacy against the weighted Chapter 6 rubric, and
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
| Var | Default | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | — | required |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | |
| `GROQ_MAX_TOKENS` | `4000` | output reservation; counts toward Groq TPM |
| `RAG_DOC_CHAR_BUDGET` | `12000` | total document text/prompt (raise on a paid Groq tier) |
| `RAG_GROUND_CHARS` | `500` | AUSTRAC snippet length per area |

**Free Groq tier = 12k tokens/min** (prompt + max_tokens). The defaults keep a
full 23-area score under that. On a paid/Dev tier, raise `RAG_DOC_CHAR_BUDGET`
and `GROQ_MAX_TOKENS` for deeper document analysis.

## Files
`rubric.js` (weighted framework — **tune this**) · `ghl.js` (fetch/enrich/download) ·
`fieldMapper.js` (fields→Q01–Q23) · `docParser.js` (PDF/Word/Excel→text) ·
`evidence.js` (download+parse uploaded files) · `rag.js` + `ingest.js` + `knowledge/`
(AUSTRAC grounding) · `groq.js` (LLM client) · `scorer.js` (prompt/score/report) ·
`routes.js` (router + admin auth + upload).

## Security & limits
Admin-only (bearer header, no `?token=`). Prompt-injection hardened (untrusted
evidence is fenced; the model treats it as data). Secrets (password/token-like
fields & values) are stripped before anything reaches Groq. Scanned/image PDFs
need OCR (not enabled) — use text-based PDFs.
