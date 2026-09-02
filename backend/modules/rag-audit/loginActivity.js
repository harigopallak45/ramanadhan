// =====================================================================
// ACCOUNT ACTIVITY — when each user last signed in, how many times, and
// whether they have ever set a password of their own (as opposed to still
// using whatever the invite or an admin reset handed them).
//
// Stored as ONE GHL custom field per contact ("Audit Login Activity", a
// small JSON blob) using the same lazy-provisioning pattern as
// assignments.js / requestReminders.js: GHL stays the single data store,
// this module only remembers WHICH field that is.
//
// One field rather than four keeps the CRM schema churn to a minimum —
// nobody filters or automates on these in GHL, they exist to be read back
// by the auditor console.
// =====================================================================
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'login-activity-field.json');

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

// provisionField: async () => { fieldId, fieldKey } — injected by the caller
// so this module has no direct GHL dependency. Only ever called the first
// time; after that the id is cached on disk and in memory.
async function resolveActivityField(provisionField) {
  if (_cache) return _cache;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored; }

  const created = await provisionField();
  const meta = { fieldId: created.fieldId, fieldKey: created.fieldKey || null };
  saveFieldMeta(meta);
  _cache = meta;
  return meta;
}

// Read-only peek: the field id if one has EVER been provisioned, or null.
// Never creates anything, so simply reading a contact can't mutate the CRM
// schema of a location where nobody has logged in yet.
function peekActivityFieldId() {
  if (_cache) return _cache.fieldId;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored.fieldId; }
  return null;
}

const EMPTY = { lastLoginAt: null, previousLoginAt: null, loginCount: 0, passwordChangedAt: null };

// Tolerant of anything already sitting in the field — a hand-edited value in
// the GHL UI must not throw on read.
function parseActivity(rawValue) {
  if (!rawValue) return { ...EMPTY };
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return {
      lastLoginAt: parsed.lastLoginAt || null,
      previousLoginAt: parsed.previousLoginAt || null,
      loginCount: Number.isFinite(parsed.loginCount) ? parsed.loginCount : 0,
      passwordChangedAt: parsed.passwordChangedAt || null
    };
  } catch {
    return { ...EMPTY };
  }
}

function serializeActivity(activity) {
  return JSON.stringify({
    lastLoginAt: activity.lastLoginAt || null,
    previousLoginAt: activity.previousLoginAt || null,
    loginCount: activity.loginCount || 0,
    passwordChangedAt: activity.passwordChangedAt || null
  });
}

// A sign-in shifts the previous timestamp down, so the console can show both
// "last seen" and the one before it without keeping a full event log.
function withLogin(activity, at = new Date().toISOString()) {
  const current = parseActivity(activity);
  return {
    ...current,
    previousLoginAt: current.lastLoginAt,
    lastLoginAt: at,
    loginCount: (current.loginCount || 0) + 1
  };
}

function withPasswordChange(activity, at = new Date().toISOString()) {
  return { ...parseActivity(activity), passwordChangedAt: at };
}

module.exports = {
  resolveActivityField,
  peekActivityFieldId,
  parseActivity,
  serializeActivity,
  withLogin,
  withPasswordChange,
  EMPTY
};
