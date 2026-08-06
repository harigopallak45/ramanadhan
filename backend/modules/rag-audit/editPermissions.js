// =====================================================================
// PER-QUESTION EDIT-PERMISSION GRANTS — while a client's submission is
// globally locked ('editing locked' GHL tag), an admin can grant back full
// edit access to specific questions only (e.g. to let a client correct one
// wrong answer) instead of unlocking everything. Stored as one GHL custom
// field per contact ("Edit Permission Granted Questions", a JSON array of
// qIds), exactly like assignments.js does for per-client question
// assignment — GHL stays the single data store, this module only remembers
// WHICH field that is.
//
// Convention: empty/missing value = "nothing specially granted" — while
// globally locked, every question falls back to the default locked
// behaviour (already-answered sub-fields read-only, blank ones still
// fillable — see routes.js's field-level lock check). This is NOT the same
// as "everything editable"; that's the unlocked (not globally locked) state.
// =====================================================================
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'edit-permissions-field.json');

function loadFieldMeta() {
  if (!fs.existsSync(STORE_PATH)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return meta && meta.fieldId ? meta : null;
  } catch {
    return null;
  }
}

function saveFieldMeta(meta) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(meta, null, 2), 'utf8');
}

let _cache = null;

// provisionField: async () => { fieldId, fieldKey } — injected by routes.js
// (same pattern as assignments.js) so this module has no direct GHL
// dependency. Only calls provisionField the FIRST time ever — after that
// the field id is cached on disk and in memory.
async function resolveGrantField(provisionField) {
  if (_cache) return _cache;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored; }

  const created = await provisionField();
  const meta = { fieldId: created.fieldId, fieldKey: created.fieldKey || null };
  saveFieldMeta(meta);
  _cache = meta;
  return meta;
}

// Read-only peek: returns the grant field id if one has EVER been
// provisioned, or null if not — never creates anything. A read path (e.g.
// checking whether a question is locked before rendering/writing an answer)
// must not trigger a live GHL write as a side effect; "no field yet" is
// treated the same as "nothing granted", which is correct — a field that
// was never created can only mean no admin ever granted anything.
function peekGrantFieldId() {
  if (_cache) return _cache.fieldId;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored.fieldId; }
  return null;
}

// null/empty return = "nothing granted".
function parseGrantedIds(rawValue) {
  const v = String(rawValue || '').trim();
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function serializeGrantedIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return '';
  return JSON.stringify(ids);
}

module.exports = { resolveGrantField, peekGrantFieldId, parseGrantedIds, serializeGrantedIds };
