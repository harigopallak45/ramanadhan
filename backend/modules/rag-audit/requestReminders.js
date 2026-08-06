// =====================================================================
// REQUEST-CLIENT FOLLOW-UP REMINDERS — when an admin sends a "Request
// client" message asking for something, and the client hasn't fully
// submitted by 3/5/7 days later, an automatic reminder email goes out at
// each threshold (once each). Stored as one GHL custom field per contact
// ("Client Request Sent At", an ISO timestamp) — same provisioning pattern
// as assignments.js/editPermissions.js: GHL stays the single data store,
// this module only remembers WHICH field that is. Which stages have
// already fired is tracked with plain tags (reminder sent 3d/5d/7d) so a
// re-run never double-sends.
// =====================================================================
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'request-timestamp-field.json');

const REMINDER_STAGES = [
  { days: 3, tag: 'reminder sent 3d' },
  { days: 5, tag: 'reminder sent 5d' },
  { days: 7, tag: 'reminder sent 7d' }
];

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

// provisionField: async () => { fieldId, fieldKey } — injected by the
// caller so this module has no direct GHL dependency. Only calls
// provisionField the FIRST time ever — after that the field id is cached
// on disk and in memory.
async function resolveTimestampField(provisionField) {
  if (_cache) return _cache;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored; }

  const created = await provisionField();
  const meta = { fieldId: created.fieldId, fieldKey: created.fieldKey || null };
  saveFieldMeta(meta);
  _cache = meta;
  return meta;
}

// Read-only peek: the field id if one has EVER been provisioned, or null —
// never creates anything. The daily reminder sweep uses this so a location
// where no admin has ever sent a request never triggers a GHL schema write.
function peekTimestampFieldId() {
  if (_cache) return _cache.fieldId;
  const stored = loadFieldMeta();
  if (stored) { _cache = stored; return stored.fieldId; }
  return null;
}

// Given one contact's tags + the raw value of the request-timestamp field,
// decide which reminder stage (if any) is due right now. Returns the stage
// object ({days, tag}) or null if: no request is pending, the client has
// FULLY submitted (a partial submission does not stop reminders — only a
// complete one does), the timestamp is missing/unparseable, or no new
// threshold has been crossed yet.
function dueReminderStage(tags, requestedAtRaw, now = new Date()) {
  const normTags = (tags || []).map((t) => String(t).toLowerCase().trim());
  if (!normTags.includes('client request triggered')) return null;
  if (normTags.includes('audit submitted') && !normTags.includes('audit submitted partial')) return null;

  const requestedAt = requestedAtRaw ? new Date(requestedAtRaw) : null;
  if (!requestedAt || Number.isNaN(requestedAt.getTime())) return null;

  const daysSince = (now.getTime() - requestedAt.getTime()) / (1000 * 60 * 60 * 24);
  for (const stage of REMINDER_STAGES) {
    if (daysSince >= stage.days && !normTags.includes(stage.tag)) return stage;
  }
  return null;
}

module.exports = { resolveTimestampField, peekTimestampFieldId, dueReminderStage, REMINDER_STAGES };
