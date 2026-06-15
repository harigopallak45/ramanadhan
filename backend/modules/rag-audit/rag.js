// =====================================================================
// Retrieval layer — grounds the AI in YOUR AUSTRAC reference material.
//
// You drop AUSTRAC rules/guidance documents into ./knowledge/, run
// `npm run rag:ingest`, and this builds a local index. At scoring time the
// scorer asks retrieve() for the passages most relevant to each review area
// and feeds them to the model, so it judges against the actual rules.
//
// Uses BM25 lexical ranking — no embeddings model, no DB, no extra API key,
// fully offline. (Embeddings can be swapped in later behind this same API.)
// =====================================================================
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'knowledge-index.json');

// Minimal English stopword list — enough to stop them dominating BM25.
const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the to was were will with this these those your you we our they their he she them than then so such not no can may must should each per via'.split(' '));

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && t.length < 30 && !STOP.has(t));
}

// Split a long document into overlapping passages for retrieval.
function chunkText(text, size = 900, overlap = 150) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += (size - overlap)) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}

// ---- Index build (used by ingest.js) -------------------------------------
// docs: [{ source, text }] → serialisable BM25 index.
function buildIndex(docs) {
  const chunks = [];
  for (const d of docs) {
    for (const c of chunkText(d.text)) {
      const terms = tokenize(c);
      if (!terms.length) continue;
      const tf = {};
      for (const t of terms) tf[t] = (tf[t] || 0) + 1;
      chunks.push({ source: d.source, text: c, len: terms.length, tf });
    }
  }
  const df = {};
  for (const ch of chunks) for (const t of Object.keys(ch.tf)) df[t] = (df[t] || 0) + 1;
  const avgdl = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);
  return { version: 1, N: chunks.length, avgdl, df, chunks };
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
}

// ---- Retrieval (used by the scorer) --------------------------------------
let _index = null;
let _loaded = false;

function loadIndex() {
  if (_loaded) return _index;
  _loaded = true;
  try {
    if (fs.existsSync(INDEX_PATH)) _index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch (e) {
    console.warn('[rag-audit] failed to load knowledge index:', e.message);
    _index = null;
  }
  return _index;
}

function isGrounded() {
  const idx = loadIndex();
  return Boolean(idx && idx.chunks && idx.chunks.length);
}

// BM25 top-k passages for a free-text query. Returns [{ source, text, score }].
function retrieve(query, k = 2) {
  const idx = loadIndex();
  if (!idx || !idx.chunks || !idx.chunks.length) return [];
  const k1 = 1.5, b = 0.75;
  const qTerms = [...new Set(tokenize(query))];

  const scored = idx.chunks.map(ch => {
    let score = 0;
    for (const t of qTerms) {
      const f = ch.tf[t]; if (!f) continue;
      const dft = idx.df[t] || 0;
      const idf = Math.log(1 + (idx.N - dft + 0.5) / (dft + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (ch.len / idx.avgdl)));
    }
    return { source: ch.source, text: ch.text, score };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

module.exports = { buildIndex, saveIndex, loadIndex, retrieve, isGrounded, tokenize, chunkText, INDEX_PATH };
