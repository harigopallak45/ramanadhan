// =====================================================================
// AI runs, report versions and storage.
//
// One click on "AI Score" is a JOB (aiRun.js): read the evidence → score
// → write the External Review Report → render Word → save to the client's
// GHL contact. That is several model calls, 2–10 minutes on a rate-limited
// key — far longer than a request should be held open — so the job runs in
// the background, the UI polls it, and whoever comes back later finds the
// finished result.
//
// Every finished run is a numbered VERSION for that contact, kept under
// backend/reports/<contactId>/ (gitignored — client data):
//   versions.json        the version index + the last job's outcome
//   <reportId>.json      the structured report (+ the score it was built on)
//   <reportId>.docx      the Word file exactly as uploaded to GHL
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
const JOB_TTL_MS = 60 * 60 * 1000;      // finished jobs are forgotten after an hour
const MAX_REPORTS_PER_CONTACT = 25;      // oldest report files pruned beyond this (the index keeps every version)

const jobs = new Map(); // jobId -> job

// GHL contact ids are alphanumeric; anything else must never become a path.
function safeId(s) {
  const v = String(s || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

function contactDir(contactId) {
  const id = safeId(contactId);
  if (!id) throw new Error('Invalid contact id');
  return path.join(REPORTS_DIR, id);
}

function readJson(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch (_) { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8');
}

// ---- Version index ---------------------------------------------------------
const indexPath = contactId => path.join(contactDir(contactId), 'versions.json');
function loadIndex(contactId) {
  const idx = readJson(indexPath(contactId), null);
  return idx && typeof idx === 'object' ? { versions: [], lastVersion: 0, lastJob: null, ...idx } : { versions: [], lastVersion: 0, lastJob: null };
}
function saveIndex(contactId, idx) { writeJson(indexPath(contactId), idx); }

function nextVersion(contactId) {
  const idx = loadIndex(contactId);
  return (Number(idx.lastVersion) || 0) + 1;
}

// Record a finished version. `entry` carries everything the UI lists
// without opening the report: score, assessment, file name, GHL file url.
function saveVersion(contactId, entry) {
  const idx = loadIndex(contactId);
  idx.versions = idx.versions.filter(v => v.version !== entry.version);
  idx.versions.push(entry);
  idx.versions.sort((a, b) => b.version - a.version);
  idx.lastVersion = Math.max(Number(idx.lastVersion) || 0, entry.version);
  saveIndex(contactId, idx);
  return entry;
}

function listVersions(contactId) {
  return loadIndex(contactId).versions;
}

function latestVersion(contactId) {
  return loadIndex(contactId).versions[0] || null;
}

// The last job's outcome is persisted too, so after a server restart the
// console can still say "the last run was interrupted at stage X" instead
// of pretending nothing happened.
function recordJob(contactId, job) {
  const idx = loadIndex(contactId);
  idx.lastJob = {
    id: job.id, status: job.status, stage: job.stage, startedAt: job.startedAt,
    finishedAt: job.finishedAt, error: job.error, version: job.version || null, reportId: job.reportId || null
  };
  saveIndex(contactId, idx);
}
function lastJob(contactId) {
  return loadIndex(contactId).lastJob;
}

// ---- Jobs ------------------------------------------------------------------
function createJob(contactId, kind = 'full') {
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    contactId,
    kind,                       // full = score + report; report = report only
    status: 'running',          // running | done | error
    stage: { step: 0, total: 0, label: 'Starting' },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    scoreResult: null,          // available as soon as the scoring stage finishes
    reportId: null,
    version: null,
    ghl: null,                  // { fileUrl, fieldId, noteAdded } or { error }
    error: null
  };
  jobs.set(job.id, job);
  try { recordJob(contactId, job); } catch (_) { /* index write is best effort */ }
  return job;
}

function getJob(jobId) {
  return jobs.get(String(jobId || '')) || null;
}

// Only one run at a time per contact — a second click while one is
// running just returns the running job instead of doubling the LLM spend.
function runningJobFor(contactId) {
  for (const j of jobs.values()) if (j.contactId === contactId && j.status === 'running') return j;
  return null;
}

// What the UI needs to show for a job without the heavy payloads.
function jobView(job) {
  if (!job) return null;
  return {
    jobId: job.id, kind: job.kind, status: job.status, stage: job.stage,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    version: job.version, reportId: job.reportId, ghl: job.ghl, error: job.error,
    hasScore: !!job.scoreResult
  };
}

function sweepJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) {
    if (j.status !== 'running' && j.finishedAt && new Date(j.finishedAt).getTime() < cutoff) jobs.delete(id);
  }
}
setInterval(sweepJobs, 10 * 60 * 1000).unref();

// ---- Report + Word storage -------------------------------------------------
function listReportFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => n.endsWith('.json') && n !== 'versions.json')
    .map(n => ({ name: n, mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function saveReport(contactId, report) {
  const dir = contactDir(contactId);
  fs.mkdirSync(dir, { recursive: true });
  const id = safeId(report.id) || crypto.randomBytes(6).toString('hex');
  report.id = id;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(report), 'utf8');
  // Prune the oldest report files (and their Word twins) so a busy contact
  // doesn't accumulate forever; the version index itself is never pruned.
  for (const f of listReportFiles(dir).slice(MAX_REPORTS_PER_CONTACT)) {
    try { fs.unlinkSync(path.join(dir, f.name)); } catch (_) { /* best effort */ }
    try { fs.unlinkSync(path.join(dir, f.name.replace(/\.json$/, '.docx'))); } catch (_) { /* best effort */ }
  }
  return id;
}

function getReport(contactId, reportId) {
  const id = safeId(reportId);
  if (!id) return null;
  return readJson(path.join(contactDir(contactId), `${id}.json`), null);
}

function latestReport(contactId) {
  const dir = contactDir(contactId);
  const [first] = listReportFiles(dir);
  return first ? readJson(path.join(dir, first.name), null) : null;
}

function saveDocx(contactId, reportId, buffer) {
  const id = safeId(reportId);
  if (!id) throw new Error('Invalid report id');
  const dir = contactDir(contactId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.docx`);
  fs.writeFileSync(file, buffer);
  return file;
}

function getDocx(contactId, reportId) {
  const id = safeId(reportId);
  if (!id) return null;
  const file = path.join(contactDir(contactId), `${id}.docx`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

module.exports = {
  createJob, getJob, runningJobFor, jobView, recordJob, lastJob,
  nextVersion, saveVersion, listVersions, latestVersion,
  saveReport, getReport, latestReport, saveDocx, getDocx,
  safeId, REPORTS_DIR
};
