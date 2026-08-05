// =====================================================================
// PER-CLIENT QUESTION ASSIGNMENT — lets an admin send only a SUBSET of the
// question bank to a given individual (picked at invite time, editable
// after). Stored as one GHL custom field per contact ("Assigned Questions",
// a JSON array of qIds) so GHL stays the single data store — this module
// only remembers WHICH field that is, exactly like questionBank.js does
// for question->field pins.
//
// Convention: empty/missing value = "all active questions assigned" (the
// default, and fully backward compatible with contacts that existed before
// this feature).
// =====================================================================
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'assignments-field.json');

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
// (same pattern as questionBank's provisionField) so this module has no
// direct GHL dependency. Only calls provisionField the FIRST time ever —
// after that the field id is cached on disk and in memory.
async function resolveAssignmentField(provisionField) {
  if (_cache) return _cache;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored; }

  const created = await provisionField();
  const meta = { fieldId: created.fieldId, fieldKey: created.fieldKey || null };
  saveFieldMeta(meta);
  _cache = meta;
  return meta;
}

// Read-only peek: returns the assignment field id if one has EVER been
// provisioned, or null if not — never creates anything. Callers that must
// not trigger a live GHL write as a side effect (e.g. a plain submit
// action) use this instead of resolveAssignmentField, and treat "no field
// yet" the same as "no assignment set" (the whole bank) — which is correct,
// since a field that was never created can only mean no admin ever
// customised anyone's question list.
function peekAssignmentFieldId() {
  if (_cache) return _cache.fieldId;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored.fieldId; }
  return null;
}

// null return = "all questions assigned" (unset / never customised).
function parseAssignedIds(rawValue) {
  const v = String(rawValue || '').trim();
  if (!v) return null;
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr) && arr.length) return arr.map(String);
    return null; // an explicit empty array also means "all" — never silently locks a client out
  } catch {
    // Tolerate a plain comma-separated value too, in case it's ever hand-edited in GHL.
    const list = v.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : null;
  }
}

function serializeAssignedIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return ''; // '' = all
  return JSON.stringify(ids);
}

module.exports = { resolveAssignmentField, peekAssignmentFieldId, parseAssignedIds, serializeAssignedIds };
