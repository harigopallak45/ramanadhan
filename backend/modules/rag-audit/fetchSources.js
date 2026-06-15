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

// Set RAG_USE_WAYBACK=1 to skip the live site and pull the archived copy.
// (Useful when austrac.gov.au is blocked from your network.)
const USE_WAYBACK = process.env.RAG_USE_WAYBACK === '1';

async function get(url, timeout = 60000) {
  return axios.get(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf,*/*' },
    timeout, maxRedirects: 5, responseType: 'arraybuffer', maxContentLength: 30 * 1024 * 1024
  });
}

function toText(buf, ctype, url) {
  if (/pdf/i.test(ctype) || url.toLowerCase().endsWith('.pdf')) {
    return parseBuffer(buf, url, ctype, { maxChars: 500000 }).then(r => r.text);
  }
  return Promise.resolve(htmlToText(buf.toString('utf8')));
}

// Resolve the most recent archived snapshot of a URL and return its raw copy.
async function fetchViaWayback(url) {
  // Ask the availability API for the closest snapshot to "now".
  let snapUrl = null;
  try {
    const a = await axios.get(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=20260601`, { timeout: 30000 });
    snapUrl = a.data?.archived_snapshots?.closest?.url || null;
  } catch (e) { /* fall through to CDX */ }
  if (!snapUrl) {
    const cdx = await axios.get(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&filter=statuscode:200&limit=-1`, { timeout: 40000 });
    const rows = (cdx.data || []).slice(1);
    if (!rows.length) throw new Error('no archived snapshot');
    const last = rows[rows.length - 1];
    snapUrl = `http://web.archive.org/web/${last[1]}/${last[2]}`;
  }
  // `id_` returns the original archived bytes without the Wayback chrome.
  const raw = snapUrl.replace(/\/web\/(\d+)\//, '/web/$1id_/');
  const res = await get(raw, 45000);
  return toText(Buffer.from(res.data), String(res.headers['content-type'] || ''), url);
}

async function fetchOne(src) {
  if (USE_WAYBACK) return fetchViaWayback(src.url);
  try {
    const res = await get(src.url);
    return await toText(Buffer.from(res.data), String(res.headers['content-type'] || ''), src.url);
  } catch (e) {
    // Live site blocked/unreachable → try the archived copy.
    return fetchViaWayback(src.url);
  }
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
