# Centinl portal — frontend

React + Vite single-page app served by the Express backend (`backend/server.js`).
Three surfaces: the client portal (`/audit`), the clients dashboard (`/admin`)
and the auditor console (`/entity/:contactId`), where one click on **AI Score**
scores the client's evidence, writes the Independent External Review Report,
renders it as Word and files it on the GHL contact.

## Develop

```bash
# backend (reads backend/.env) — http://localhost:5001
node --no-experimental-fetch ../backend/server.js
# frontend — http://localhost:5173, talks to the backend above
node node_modules/vite/bin/vite.js
```

`vite.js` is invoked directly because npm's Windows shim mis-parses the repo
path's ampersand. Lint with `npm run lint`.

## Build for the cPanel deploy

The host serves the build from the `/audit` sub-path and cannot run Vite, so
`dist/` is built here and committed:

```bash
VITE_BASE_PATH=/audit npm run build      # PowerShell: $env:VITE_BASE_PATH="/audit"; npm run build
```

## Tests (Playwright)

```bash
npm run test:e2e            # UI suites: login, dashboard, client portal, auditor console, report preview
npm run test:e2e:ui         # same, in Playwright's UI mode
npm run test:e2e:report     # open the last HTML report
```

The UI suites run against the Vite dev server (started automatically, or
reused if already up) with a **fake API** installed through `page.route`
(`e2e/fixtures/fakeBackend.cjs`) — no backend, GHL or model is needed, and the
AI run's polling flow is deterministic. Fixtures are fictional; their shapes
come from the backend's own `reportSections.js` / `rubric.js` so they can't
drift from what the app renders. The `mobile` project re-runs the console
layout check at a phone viewport.

Read-only smoke checks against the **real** backend (auth, config, the run
endpoints, a Word download for a contact that already has versions) are in
`e2e/live/` and run only when asked:

```powershell
$env:E2E_LIVE = "1"; $env:E2E_CONTACT = "<contactId with saved versions>"
npx playwright test --project=live-api
```

They mint a local admin token from `backend/.env`'s `JWT_SECRET` and never
start an AI run (that takes minutes, spends model tokens and writes to GHL).

First-time setup: `npx playwright install chromium`.
