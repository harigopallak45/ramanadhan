# Deploying / moving the Centinl backend

The app is almost stateless: real data lives in **GoHighLevel (cloud)**, and the
only local state is the AI grounding index (plain files). So it moves easily.

Three things are **deliberately kept out of git** (so secrets/data never leak):
`backend/.env`, `backend/node_modules`, and the RAG memory
(`modules/rag-audit/knowledge/*` + `knowledge-index.json`).

---

## Option A — Copy the whole folder (simplest)
Zip `D:\Project\ramanadhan`, move it (USB / Drive / etc.), unzip on the target.
This carries everything, including `.env` and the trained index.

1. Install **Node.js 18+** on the target.
2. `cd backend && npm start`.

⚠️ Windows → Linux: delete `backend/node_modules` first and run `npm install` on
the target (the folder copies fine, but a fresh install avoids OS edge cases).

## Option B — Git (servers)
```bash
git clone <repo> && cd backend
npm install
#  create .env  (copy from a secure place — it is NOT in git)
npm run rag:fetch     # re-train AUSTRAC grounding (or copy the files, below)
npm start
```

### Restoring the 3 git-excluded pieces
| Piece | Restore |
| --- | --- |
| `backend/.env` | copy the file over, or recreate it (see backend/README.md → Environment) |
| `node_modules` | `npm install` |
| RAG memory | `npm run rag:fetch` **or** copy `modules/rag-audit/knowledge/` + `knowledge-index.json` from a trained machine |

The index has **no machine-specific paths** — copying it to any OS works as-is.

---

## Production notes
- Put it behind a reverse proxy. The API is dual-mounted at `/api/...` and
  `/hlgp/api/...`; production uses the `/hlgp` base.
- Set a strong `JWT_SECRET` (the app refuses AI routes if it is unset).
- Open the `PORT` (default 5001) to the proxy only, not the public internet.
- austrac.gov.au is reachable from Australian hosts; from overseas hosts the
  fetcher automatically falls back to the Internet Archive
  (`RAG_USE_WAYBACK=1` forces it).
- Keep `.env` out of any image/repo; inject it as a secret at runtime.
