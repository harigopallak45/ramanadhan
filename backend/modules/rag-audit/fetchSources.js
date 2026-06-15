// =====================================================================
// Repeatable knowledge fetcher.
//   npm run rag:fetch     → download every source in knowledge-sources.json
//                           into knowledge/ as text, then rebuild the index.
//
// Edit knowledge-sources.json to add/remove AUSTRAC URLs, then re-run.
// Sources that fail (offline, blocked, moved) are skipped and reported —
// the run still succeeds with whatever it could fetch.
//
// NOTE: austrac.gov.au can be slow or block non-Australian networks. Run this
// from your machine (in Australia) to fetch the guidance pages. legislation.gov.au
// (the actual Act + Rules) is reachable from anywhere.
// =====================================================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseBuffer } = require('./docParser');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
// Override with RAG_SOURCES_FILE to keep alternate source lists.
const SOURCES_FILE = process.env.RAG_SOURCES_FILE || path.join(__dirname, 'knowledge-sources.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Decode the handful of HTML entities that actually show up in gov pages.
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&[a-z]+;/gi, ' ');
}

// Strip an HTML page down to readable body text, preferring the main content.
function htmlToText(html) {
  let t = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|nav|header|footer|svg|form|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const main = t.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) t = main[2];
  t = t
    .replace(/<\/(p|div|li|h[1-6]|tr|section|td|th)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(t).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchOne(src) {
  const res = await axios.get(src.url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf,*/*' },
    timeout: 60000, maxRedirects: 5, responseType: 'arraybuffer', maxContentLength: 30 * 1024 * 1024
  });
  const ctype = String(res.headers['content-type'] || '');
  const buf = Buffer.from(res.data);

  let text;
  if (/pdf/i.test(ctype) || src.url.toLowerCase().endsWith('.pdf')) {
    const r = await parseBuffer(buf, src.url, ctype, { maxChars: 500000 });
    text = r.text;
  } else {
    text = htmlToText(buf.toString('utf8'));
  }
  return text;
}

async function run() {
  if (!fs.existsSync(SOURCES_FILE)) { console.error('[fetch] knowledge-sources.json not found'); process.exit(1); }
  if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const { sources } = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
  let ok = 0, fail = 0;

  for (const src of (sources || [])) {
    try {
      const text = await fetchOne(src);
      if (!text || text.length < 200) { console.warn(`[fetch] ✗ ${src.slug} — too little text (${text ? text.length : 0} chars)`); fail++; continue; }
      const out = path.join(KNOWLEDGE_DIR, `${src.slug}.txt`);
      fs.writeFileSync(out, `SOURCE: ${src.label}\nURL: ${src.url}\n\n${text}`);
      console.log(`[fetch] ✓ ${src.slug} — ${text.length} chars`);
      ok++;
    } catch (e) {
      console.warn(`[fetch] ✗ ${src.slug} — ${e.response?.status || e.code || e.message}`);
      fail++;
    }
  }

  console.log(`[fetch] done: ${ok} fetched, ${fail} skipped. Rebuilding index…`);
  if (ok === 0) { console.error('[fetch] Nothing fetched — index not rebuilt.'); process.exit(1); }
}

run().catch(e => { console.error('[fetch] failed:', e.message); process.exit(1); });
