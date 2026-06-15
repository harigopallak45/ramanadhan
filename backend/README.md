# Centinl — Audit Portal Backend

Node.js / Express backend for the **Centinl** AUSTRAC AML/CTF s.161 independent
review portal. It powers authentication, the auditor/admin console, the client
portal, and the **AI compliance analyzer** (`rag-audit` module).

- **Data store:** GoHighLevel (GHL) CRM — there is no local database. Users are
  GHL contacts; audit answers and uploads are GHL custom fields; roles are GHL tags.
- **AI:** Groq (LLM scoring) + a local BM25 knowledge index for AUSTRAC grounding.
- **Frontend:** static HTML in `../frontend`, served by this backend.

---

## 1. Setup

```bash
cd backend
npm install
# create .env (see below)
npm start            # production → http://localhost:5001
npm run dev          # watch mode
```

### Environment (`backend/.env`)
| Var | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (5001) | HTTP port |
| `JWT_SECRET` | **yes** | signs auth tokens — set a long random value |
| `GHL_API_KEY` | **yes** | GoHighLevel private integration token |
| `GHL_LOCATION_ID` | **yes** | GHL location (sub-account) id |
| `BACKEND_URL` | no | used to decide local vs prod link building |
| `FRONTEND_URL` | no | public client domain for email links |
| `GHL_ADMIN_TAG` / `GHL_USER_TAG` | no | role tags (default `audit admin` / `audit user`) |
| `GHL_*_FIELD_ID` | no | custom-field ids (auto-resolved by name if omitted) |
| `GHL_INVITE_WEBHOOK_URL` | no | optional outbound webhook on invite |
| `GROQ_API_KEY` | for AI | Groq API key (AI scoring) |
| `GROQ_MODEL` | no | default `llama-3.3-70b-versatile` |
| `GROQ_MAX_TOKENS` | no | output reservation (default 4000) |
| `RAG_DOC_CHAR_BUDGET` | no | document text budget per score (default 12000) |
| `RAG_GROUND_CHARS` | no | AUSTRAC snippet length per area (default 500) |

> `.env` is gitignored — never commit it. See [DEPLOY.md](DEPLOY.md) for moving the
> app to another machine/server.

---

## 2. Conventions

- **Dual mount:** every API path below is served at **both** `/api/...` **and**
  `/hlgp/api/...` (the `/hlgp` prefix is the production reverse-proxy base).
- **Auth:** JSON Web Token in `Authorization: Bearer <token>`. Tokens carry
  `{ id, email, role }`; `role` is `admin` or `user`.
- **Responses:** JSON `{ "success": true|false, ... }`. Errors include `message`.
- **Roles** come from GHL tags: `audit admin` → admin, `audit user` → user.

---

## 3. API reference

### 3.1 Public / Auth — no token
| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/login` | `{ email, password }` | `{ success, token, isAdmin, user }` · 404 `needsRegistration` if unknown · 401 on bad password |
| POST | `/api/signup` | `{ name, email, company, password }` | `{ success, message }` — creates/activates a GHL contact, tags `audit user` |
| POST | `/api/forgot-password` | `{ email }` | `{ success, message }` — emails a 1-hour reset link via GHL |
| GET | `/api/verify-token?token=` | — | `{ success, name, email, type }` — validates a reset/invite link |
| POST | `/api/reset-password` | `{ token, password }` | `{ success, message }` — sets password (token type `reset`/`invite` only) |
| GET | `/api/config` | — | `{ success, backendUrl }` — public client config |
| GET | `/api/modules` | — | `{ success, modules: [] }` — active dynamic modules |

### 3.2 Admin — `Authorization: Bearer <admin token>`
| Method | Path | Body | Returns / effect |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | — | `{ success, users[], total, scanned, locationId }` — all audit users (paginated GHL scan) |
| GET | `/api/admin/users/:id` | — | `{ success, contact }` — full contact, secrets stripped |
| POST | `/api/admin/invite` | `{ firstName, lastName, email, company }` | creates contact + emails invite link, tags `audit user` |
| POST | `/api/admin/reset-password/:id` | `{ message? }` | emails a reset link to the contact (optional custom message) |
| POST | `/api/admin/request-client/:id` | `{ message }` | emails the client an "action required" request |
| POST | `/api/admin/users/:id/role` | `{ action }` | `action` = `promote_admin` \| `demote_admin` \| `revoke_access` |
| POST | `/api/admin/users/:id/edit-permission` | `{ action }` | `action` = `unlock` \| `lock` (client editing) |
| POST | `/api/admin/bulk-tag` | `{ contactIds[], tag, action }` | bulk add/remove a GHL tag |
| POST | `/api/admin/bulk-nudge` | `{ contactIds[] }` | tags `nudge requested` to trigger reminders |

### 3.3 Client — `Authorization: Bearer <user token>`
| Method | Path | Body | Returns / effect |
| --- | --- | --- | --- |
| GET | `/api/client/profile` | — | `{ success, contact, done, editingUnlocked }` |
| POST | `/api/client/submit` | — | marks `audit submitted`, revokes editing |

### 3.4 AI compliance analyzer (`rag-audit` module) — admin token
| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| GET | `/api/rag-audit/health` | — | `{ success, configured, model }` |
| POST | `/api/rag-audit/score/:contactId` | query `?docs=0` (skip doc reading), `?save=1` (log to GHL) | `{ success, result }` — see result shape below |
| POST | `/api/rag-audit/analyze-upload` | multipart: `files[]` (≤30, ≤15 MB ea), `entityLabel?`, `contactId?` | `{ success, result }` — auditor direct upload |
| POST | `/api/rag-audit/note/:contactId` | `{ body }` | `{ success, message }` — append a note to GHL |

**`result` shape (score endpoints):**
```jsonc
{
  "score": 0,                 // 0–100 final (after critical deductions)
  "rawScore": 18,             // before deductions
  "deduction": 12,            // critical-gap penalty
  "criticalFailures": 4,
  "rating": "Critical — Non-Compliant",
  "tone": "critical",         // pass|watch|fail|critical (UI colour)
  "executiveSummary": "…",
  "topRisks": ["…"],
  "areas": [                  // 23 review areas Q01–Q23
    { "qId": "Q16", "title": "…", "weight": 8, "adequacy": 0, "efficacy": 0,
      "weightedMark": 0, "maxMark": 8, "status": "missing|inadequate|partial|adequate|error",
      "criticalFailure": true, "finding": "…", "recommendation": "…" }
  ],
  "areasReturned": 23,
  "incompleteModelOutput": [], // areas the LLM failed to grade (re-run flag)
  "documents": { "read": 14, "unreadable": 0 },
  "upload": { "files": 4, "matched": 3, "unmatched": ["…"] }, // upload endpoint only
  "grounded": true,           // whether AUSTRAC knowledge index was used
  "draftReport": "…"          // plain-text findings the auditor can copy
}
```
Module internals, the scoring rubric, and the grounding ("training") workflow are
documented in [`modules/rag-audit/README.md`](modules/rag-audit/README.md).

### 3.5 System / webhook
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/webhook/ghl-receiver` | none | inbound GHL webhook sink |

### 3.6 Page routes (HTML, served from `../frontend`)
| Path | Guard | Page |
| --- | --- | --- |
| `/`, `/hlgp`, `/v2`, `/audit/login`, `/auth`, `/login-page` | none | `auth.html` (login) |
| `/audit` | client token | `audit.html` (client portal) |
| `/admin` | admin token | `admin.html` (roster) |
| `/entity?id=<contactId>` | admin token | `entity.html` (per-entity review + AI score) |
| `/reset-password`, `/reset?token=` | token in URL | `reset-password.html` |

---

## 4. AI "training" (AUSTRAC grounding) commands
| Command | What it does |
| --- | --- |
| `npm run rag:fetch` | download the AUSTRAC URLs in `modules/rag-audit/knowledge-sources.json` → `knowledge/` → rebuild the index |
| `npm run rag:ingest` | rebuild the index from whatever is already in `knowledge/` |

The grounding index (`modules/rag-audit/knowledge-index.json`) and fetched docs
are **local and gitignored** — regenerate or copy them per machine.

---

## 5. Module loader

Folders under `backend/modules/<name>/` with a `routes.js` are auto-mounted at
`/api/<name>` and `/hlgp/api/<name>` on boot (see the bottom of `server.js`).
`rag-audit` is the first such module.

---

## 6. Project layout
```
backend/
  server.js                  # core API + auth + page routes + module loader
  modules/rag-audit/         # AI compliance analyzer (see its README)
  package.json               # deps + npm scripts (start, dev, rag:fetch, rag:ingest)
  .env                       # secrets (gitignored)
../frontend/                 # static HTML served by this backend
```
