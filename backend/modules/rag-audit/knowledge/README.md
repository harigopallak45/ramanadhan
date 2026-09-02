# Knowledge base — AUSTRAC reference material

Two ways to fill this:

**A. Auto-fetch from the web (repeatable)**
```bash
npm run rag:fetch      # downloads every URL in ../knowledge-sources.json, then indexes
```
Edit `../knowledge-sources.json` to add/remove AUSTRAC URLs, then re-run.
⚠️ austrac.gov.au may be slow or blocked from **overseas** networks — run this from
your own machine (in Australia). legislation/PDF sources are reachable anywhere.

**B. Drop your own documents**
Put any AUSTRAC PDFs/Word/Excel/text in this folder, then:
```bash
npm run rag:ingest     # indexes whatever is already in this folder
```

Either way it builds `knowledge-index.json`, and from then on the AI scorer
retrieves the most relevant rule passages for each review area and judges
submissions against them (grounding / "training" without model training).

## What to put here
- AUSTRAC AML/CTF Rules, guidance notes, regulatory guides
- The relevant parts of the AML/CTF Act you score against
- Your firm's audit methodology / Chapter 6 framework notes
- "What good looks like" examples for each control

## Supported formats
PDF, Word (.docx), Excel/CSV, plain text, Markdown. (Scanned/image PDFs need
OCR, which isn't enabled — use text-based PDFs.)

## Notes
- Re-run `npm run rag:ingest` whenever you add or change documents.
- Everything stays **local** — these documents are never sent anywhere except,
  for the small retrieved snippets, to the scoring model at analysis time.
- Until you ingest something, scoring still works — just ungrounded (rubric only).
