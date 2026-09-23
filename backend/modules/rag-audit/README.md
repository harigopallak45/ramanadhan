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
   The grading is sized to the model key's per-minute token cap: document
   text is trimmed to fit and, when the areas still do not fit one call, they
   are graded in batches (two calls of ~12 areas on Groq's 8k tier) with one
   short extra call for the overall opinion — a client with many documents
   scores instead of being refused as "request too large".
   The score carries both the scorecard rating and the report wording
   ("Overall Assessment: Effective with Moderate Enhancement Opportunities",
   "Indicative Overall Compliance Rating: 79/100") — see `ASSESSMENT_BANDS` in `rubric.js`.
   Critical gaps each deduct 3 marks, capped at 15 in total (`CRITICAL_DEDUCTION_CAP`)
   so a thin submission still shows what WAS evidenced instead of flooring at 0.
5. **Report** — the Independent External Review Report (below), plus the terse draft findings.

## The Independent External Review Report
The formal document issued to the entity, built to the structure of the firm's
signed reports:

```
Cover (year · reviewer · Centinl · date · logo · "AML/CTF External Review Report")
1. Executive Summary                → Overall Assessment + Indicative Overall Compliance Rating NN/100
2. Business Profile                 → 23-row table (Legal Name, ABN, ACN, Registered Office, Director/UBO,
                                      Compliance Officer, Branches, Countries Serviced, AUSTRAC Registration …)
                                      + Business Overview
3. Scope and Methodology            → 3.1 Scope · 3.2 Methodology · 3.3 Areas Reviewed · 3.4 Limitations
4. Detailed Compliance Review       → areas A–Q, each: Requirement + Auditor Observation
5. Opportunities for Improvement    → intro + bullet list
6. Key Strengths · 7. Key Red Flags · 8. Overall Conclusion → assessment lines, signature, sign-off
```

* `reportSections.js` — the seventeen lettered areas (A–Q), their fixed
  **Requirement** wording (code, never model output) and which of the 23
  evidence questions feed each one (`questionIds` get their document text;
  `contextIds` verdicts + answers only). Any admin-added question no area
  claims becomes its own lettered area, so nothing scored is left out.
* `fullReport.js` — the writer. Takes the scorecard verdicts (never
  re-grades) and the evidence WITH document text, and runs bounded stages:
  business-profile extraction → observations (batched, ~6 areas a call) →
  executive summary / overview / conclusion → strengths / red flags /
  opportunities → assembly. Each stage is sized to the provider's token cap
  (`fitToBudget`), shrinks its document excerpts if the provider refuses the
  request as too large, and a failed stage leaves a marked placeholder plus a
  warning instead of sinking the run. Output is structured JSON + `fullText`.
* `reportDocx.js` — Word rendering (`docx` package): A4, Aptos, the grey
  cover band, heading hierarchy, the profile table, bullets, the signature
  mark from `assets/`, "Page X of Y" footer, and a shaded "Draft notes" box
  when anything needs the auditor's eye.
* `aiRun.js` — **what one click on "AI Score" does**, as a background job:
  read evidence → score → write the report → render Word → save it as the
  contact's next **version** → attach it to the client's GHL contact (the
  Word file into the *AI Score Reports* field, the summary line into
  *AI Score*, plus an activity note). The console polls the job and shows a
  progress bar; whoever comes back later finds the finished result.
* `reportStore.js` — jobs + storage. Every finished run is a numbered
  version under `backend/reports/<contactId>/` (gitignored): `versions.json`
  (the index + the last job's outcome, so an interrupted run is reported
  after a restart), `<reportId>.json` (report + the score it was built on)
  and `<reportId>.docx` (the exact file filed on GHL).
* `reportFields.js` — the two GHL contact fields, provisioned once on the
  first completed run and cached in `report-fields.json`:
  `Centinl RRS — AI Score` (TEXT) and `Centinl RRS — AI Score Reports`
  (FILE_UPLOAD, one `…_vN.docx` per version, uploaded the same way client
  evidence is so GHL's own UI shows them).

Engagement defaults printed on the report (overridable per run from the UI):

| Var | Default |
| --- | --- |
| `REPORT_AUDITOR_NAME` | `Ramanathan Karuppiah` |
| `REPORT_AUDITOR_CREDENTIALS` | `MBA, CAMS-Audit, FIPA, FICA` |
| `REPORT_FIRM_NAME` | `Financial Crime Audits Pty Ltd` |
| `REPORT_BRAND_NAME` | `Centinl` |

## Endpoints (admin-JWT, bearer header only)
| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/health` | Config + model status |
| POST | `/score/:contactId` | Score an entity from GHL (reads their uploaded docs). `?docs=0` skips doc reading; `?save=1` logs to GHL |
| POST | `/score/:contactId/run` | **The AI Score run** (score + report + Word + GHL) as a job. Body: `{ options:{ auditorName, auditorCredentials, firmName, engagementDate, asAtDate, concludedDate } }` → `202 { jobId, stage }` |
| GET  | `/score/:contactId/run/status/:jobId` | `{ status: running / done / error, stage:{step,total,label}, result? (score, as soon as it exists), report? (when done), version, ghl }` |
| GET  | `/score/:contactId/runs` | On-load state: `running` job, `lastJob` outcome, `versions[]`, `latest { report, result }` |
| POST | `/score/:contactId/full-report` | Report-only job around an already-scored result (a new version without re-scoring). Body: `{ areas, score, rating, criticalFailures, scoredAt, entityLabel, options }` → `202 { jobId }` |
| GET  | `/score/:contactId/full-report/:reportId` | One saved report (JSON, includes `scoreResult`) |
| GET  | `/score/:contactId/full-report/:reportId/docx` | Word download (`<Entity>_ExternalReview_Report_<year>_vN.docx`) |
| GET  | `/score/:contactId/ghl-report-files` | The report files GHL holds on the contact's *AI Score Reports* field |
| GET  | `/report-defaults` | Auditor / firm defaults for the UI form |
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

### Reasoning engine (swappable, with backups — see `llm.js`)
The brain (rubric + knowledge + retrieval + scoring math) is local and owned;
this only picks the language model it feeds. Switch with one line — the brain
hands any engine identical context. Set `local` to keep all data on-machine.

Two steps: **`LLM_PROVIDER`** is the primary every call goes to first;
**`LLM_FALLBACK_PROVIDERS`** are the backups. When the primary is down
(5xx / unreachable), rejects its key, is rate-limited for longer than
`LLM_FAILOVER_WAIT_MS`, or returns a truncated or non-JSON answer, the same
prompt is re-sent to the next backup — so a run that started on Groq finishes
on Claude rather than failing. An engine that failed on an outage-type error
is rested for `LLM_FAILOVER_COOLDOWN_MS` (a rejected key: 30 min) so the rest
of the job goes straight to the backup; it is tried again once the cooldown
lapses, or immediately if nothing else is left. The score and report record
the engine that actually answered (`provider` / `model`), and
`GET /health` lists the chain with each engine's state.

| Var | Default | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `groq` | primary: `groq` \| `openai` \| `anthropic` \| `local` |
| `LLM_FALLBACK_PROVIDERS` | every other provider with a key, `anthropic → openai → groq` | backups in order, e.g. `anthropic,openai`; empty disables failover. `local` only when named. |
| `LLM_FAILOVER_RETRIES` / `LLM_FAILOVER_WAIT_MS` | `2` / `20000` | with a backup, the primary gets at most this many 429/5xx retries, and a `retry-after` longer than this hands over at once |
| `LLM_FAILOVER_COOLDOWN_MS` | `300000` | how long a failed engine is rested |
| `LLM_TIMEOUT_MS` | `60000` groq / `180000` others | per-call timeout |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `openai/gpt-oss-120b` | provider: groq |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-4o-mini` | provider: openai |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-sonnet-5` | provider: anthropic |
| `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` | `http://localhost:11434/v1/chat/completions` / `llama3.1` | provider: local (Ollama/LM Studio/llama.cpp) — no key, no data leaves the machine |
| `LLM_REASONING_EFFORT` | `low` | Sent to reasoning models only (gpt-oss, o-series, gpt-5…). Their hidden reasoning tokens count against `max_tokens` — at the default effort a 23-area score comes back truncated. `none` sends nothing. |
| `LLM_RETRY_MAX` / `LLM_RETRY_BASE_MS` | `4` / `15000` | 429/5xx retries; the server's `retry-after` is honoured when sent |
| `LLM_TPM_LIMIT` | learnt from response headers (Groq free tier: 8000) | Per-minute token cap the report writer sizes its prompts to |

### Scoring budget
| Var | Default | Notes |
| --- | --- | --- |
| `GROQ_MAX_TOKENS` | `4000` | output reservation; counts toward Groq TPM |
| `RAG_DOC_CHAR_BUDGET` | `12000` | total document text/prompt (raise on a paid tier) |
| `RAG_GROUND_CHARS` | `500` | AUSTRAC snippet length per area |

**Free Groq tier = 8k tokens/min for gpt-oss-120b** (prompt + max_tokens; a
single request over the cap is refused outright with "Request too large").
The defaults keep a full 23-area score under that. The report writer sizes
every call to the cap it learns from the response headers and waits out the
per-minute limit between stages — expect 2–5 minutes per report on the free
tier, well under a minute on a Dev tier. On a paid tier (or another provider)
raise `RAG_DOC_CHAR_BUDGET`, `GROQ_MAX_TOKENS` and the report budgets below.

### Report budget
| Var | Default | Notes |
| --- | --- | --- |
| `REPORT_MAX_TOKENS` | `2300` | output reservation per observation batch |
| `REPORT_NARRATIVE_MAX_TOKENS` | `2500` | output reservation for the narrative calls |
| `REPORT_DOC_CHAR_BUDGET` | `14000` | document text per observation batch (upper bound; scaled to fit) |
| `REPORT_PROFILE_CHAR_BUDGET` | `14000` | document text for business-profile extraction |
| `REPORT_SECTIONS_PER_BATCH` | `6` | areas written per call |

## Files
`rubric.js` (weighted framework + rating/assessment bands — **tune this**) · `ghl.js` (fetch/enrich/download) ·
`fieldMapper.js` (fields→Q01–Q23) · `docParser.js` (PDF/Word/Excel→text) ·
`evidence.js` (download+parse uploaded files) · `rag.js` + `ingest.js` + `knowledge/`
(AUSTRAC grounding) · `llm.js` (provider-agnostic reasoning adapter — groq/openai/anthropic/local, primary + backup failover chain, retry + token-cap awareness; `npm test` covers the failover) · `groq.js` (deprecated shim → `llm.js`) · `scorer.js` (prompt/score/draft findings) ·
`reportSections.js` (report areas A–Q + requirement wording) · `fullReport.js` (External Review Report writer) ·
`reportDocx.js` (Word rendering) · `aiRun.js` (the one-click run job) · `reportStore.js` (jobs, versions, saved reports) · `reportFields.js` (GHL "AI Score" fields) · `assets/` (logo, signature mark) ·
`routes.js` (router + admin auth + upload).

## Tests
End-to-end tests live in `frontend/e2e` (Playwright): the UI suites use a fake
API, and `frontend/e2e/live/` holds read-only smoke checks against this
backend — see `frontend/README.md`.

## Security & limits
Admin-only (bearer header, no `?token=`). Prompt-injection hardened (untrusted
evidence is fenced; the model treats it as data). Secrets (password/token-like
fields & values) are stripped before anything reaches Groq. Scanned/image PDFs
need OCR (not enabled) — use text-based PDFs.
