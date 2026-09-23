// =====================================================================
// GHL fields that carry the AI result on the client's CONTACT — so the
// score and every issued report version are visible in GoHighLevel itself,
// not only in this portal:
//
//   "AI Score"          TEXT         latest result, e.g.
//                                    "v3 · 79/100 · Effective with Moderate
//                                     Enhancement Opportunities · 15 Sep 2026"
//   "AI Score Reports"  FILE_UPLOAD  every report version as a Word file
//                                    (…_v1.docx, …_v2.docx, …) — the same
//                                    mechanism client evidence uploads use
//
// Same pattern as assignments.js: the fields are provisioned in GHL the
// FIRST time a run completes (an explicit, admin-triggered action), then
// their ids are cached on disk here so no later run touches the schema.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { createCustomField, uploadCustomFieldFile, getRawCustomFields, updateContactFields } = require('./ghl');
const fileNames = require('./fileNames');

const STORE_PATH = path.join(__dirname, 'report-fields.json');
const FIELD_NAME_PREFIX = 'Centinl RRS — ';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let _cache = null;

function loadMeta() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const meta = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (meta && meta.files && meta.files.fieldId && meta.score && meta.score.fieldId) { _cache = meta; return meta; }
    }
  } catch (_) { /* fall through to provisioning */ }
  return null;
}

function saveMeta(meta) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(meta, null, 2), 'utf8');
  _cache = meta;
}

// Resolve (provisioning once) the two field ids.
async function resolveFields() {
  const stored = loadMeta();
  if (stored) return stored;
  const files = await createCustomField({ name: FIELD_NAME_PREFIX + 'AI Score Reports', dataType: 'FILE_UPLOAD' });
  const score = await createCustomField({ name: FIELD_NAME_PREFIX + 'AI Score', dataType: 'TEXT' });
  const meta = {
    files: { fieldId: files.fieldId, fieldKey: files.fieldKey || null },
    score: { fieldId: score.fieldId, fieldKey: score.fieldKey || null }
  };
  saveMeta(meta);
  return meta;
}

// Read-only peek — never provisions.
function peekFields() { return loadMeta(); }

// Attach one report version to the contact: upload the Word file into the
// FILE_UPLOAD field (merging with the versions already there — the upload
// endpoint replaces the whole field), then write the summary line. Returns
// what was written so the caller can record the GHL file url on the version.
async function attachReportVersion(contactId, { buffer, fileName, summary }) {
  const meta = await resolveFields();

  const rawBefore = await getRawCustomFields(contactId);
  const existingRaw = rawBefore.find(f => f.id === meta.files.fieldId);
  const existingValue = (existingRaw?.value && typeof existingRaw.value === 'object' && !Array.isArray(existingRaw.value))
    ? existingRaw.value
    : {};

  const newValue = await uploadCustomFieldFile(contactId, meta.files.fieldId, buffer, fileName, DOCX_MIME);
  const merged = { ...existingValue, ...newValue };
  const updates = [{ id: meta.score.fieldId, value: String(summary || '').slice(0, 250) }];
  // Re-save the merged file set (only needed when there was something to
  // keep) together with the summary line in one contact update.
  if (Object.keys(existingValue).length) updates.push({ id: meta.files.fieldId, value: merged });
  await updateContactFields(contactId, updates);

  const newKey = Object.keys(newValue)[0];
  const entry = newValue[newKey] || {};
  if (entry.url) fileNames.set(entry.url, fileName);
  return {
    fileUrl: entry.url || null,
    documentId: entry.documentId || null,
    filesFieldId: meta.files.fieldId,
    scoreFieldId: meta.score.fieldId,
    filesOnField: Object.keys(merged).length
  };
}

// The versions currently sitting on the contact's field, newest first —
// read straight from GHL so the UI shows what GHL actually holds.
async function listContactReportFiles(contactId) {
  const meta = peekFields();
  if (!meta) return [];
  const raw = await getRawCustomFields(contactId);
  const field = raw.find(f => f.id === meta.files.fieldId);
  const value = field?.value;
  if (!value || typeof value !== 'object') return [];
  const entries = Array.isArray(value)
    ? value.filter(u => typeof u === 'string').map(u => ({ url: u, meta: {} }))
    : Object.values(value).filter(v => v && v.url);
  return entries.map(e => ({
    url: e.url,
    name: (e.meta && e.meta.originalname) || fileNames.get(e.url) || '',
    size: (e.meta && e.meta.size) || null,
    documentId: e.documentId || null
  })).reverse();
}

module.exports = { resolveFields, peekFields, attachReportVersion, listContactReportFiles, DOCX_MIME };
