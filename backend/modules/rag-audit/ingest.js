// =====================================================================
// One-command knowledge-base builder.
//   npm run rag:ingest
// Reads every document in ./knowledge/, extracts text (PDF/Word/Excel/txt/md),
// builds the BM25 retrieval index, and writes knowledge-index.json.
// Re-run whenever you add or update AUSTRAC reference documents.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { parseBuffer } = require('./docParser');
const { buildIndex, saveIndex, INDEX_PATH } = require('./rag');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');

async function run() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.error(`[ingest] knowledge folder not found: ${KNOWLEDGE_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => !f.startsWith('.') && f.toLowerCase() !== 'readme.md');
  if (!files.length) {
    console.error('[ingest] No documents in knowledge/. Drop your AUSTRAC PDFs/docs there and re-run.');
    process.exit(1);
  }

  const docs = [];
  for (const file of files) {
    const full = path.join(KNOWLEDGE_DIR, file);
    if (!fs.statSync(full).isFile()) continue;
    const buf = fs.readFileSync(full);
    // Knowledge docs (legislation/guidance) are long — don't truncate at the
    // small evidence cap.
    const r = await parseBuffer(buf, file, '', { maxChars: 500000 });
    if (r.ok && r.text) {
      docs.push({ source: file, text: r.text });
      console.log(`[ingest] ✓ ${file} — ${r.text.length} chars`);
    } else {
      console.warn(`[ingest] ✗ ${file} — ${r.note || 'no text extracted'}`);
    }
  }

  if (!docs.length) {
    console.error('[ingest] No readable documents. Nothing indexed.');
    process.exit(1);
  }

  const index = buildIndex(docs);
  saveIndex(index);
  console.log(`[ingest] Indexed ${docs.length} document(s) → ${index.N} passages → ${INDEX_PATH}`);
}

run().catch(e => { console.error('[ingest] failed:', e.message); process.exit(1); });
