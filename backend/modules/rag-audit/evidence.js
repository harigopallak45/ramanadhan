// =====================================================================
// Turns the file references on each review area into READ document text.
// Downloads every uploaded file, parses its contents, and attaches a
// `docs` array to the group so the scorer can judge efficacy from what the
// documents actually say — not just that a file exists.
// =====================================================================
const { downloadFile } = require('./ghl');
const { parseBuffer } = require('./docParser');

// Bounded parallelism so a contact with 30 files doesn't open 30 sockets.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// Collect every {qId, file} across all groups, fetch+parse once, write back.
async function attachDocuments(groups, { concurrency = 5 } = {}) {
  const jobs = [];
  for (const qId of Object.keys(groups)) {
    groups[qId].docs = [];
    for (const f of (groups[qId].files || [])) {
      if (f && f.url) jobs.push({ qId, name: f.name, url: f.url, originalName: f.originalName, mimetype: f.mimetype });
    }
  }
  if (!jobs.length) return { groups, parsed: 0, failed: 0 };

  let parsed = 0, failed = 0;
  const results = await mapLimit(jobs, concurrency, async (job) => {
    const buf = await downloadFile(job.url);
    if (!buf) return { ...job, ok: false, note: 'download failed', text: '' };
    const r = await parseBuffer(buf, job.originalName || job.name, job.mimetype);
    return { ...job, ok: r.ok, note: r.note || '', text: r.text || '' };
  });

  for (const r of results) {
    if (r.ok && r.text) parsed++; else failed++;
    groups[r.qId].docs.push({ name: r.name, ok: r.ok, note: r.note, text: r.text });
  }
  return { groups, parsed, failed };
}

module.exports = { attachDocuments };
