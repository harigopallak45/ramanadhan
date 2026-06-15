// =====================================================================
// GHL helper for the rag-audit module.
// Fetches a contact and enriches its custom fields with the field
// DEFINITIONS (name + dataType) — mirroring server.js enrichAndFilterContact,
// but self-contained so the module has no dependency on server.js internals.
// =====================================================================
const axios = require('axios');

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_BASE = 'https://services.leadconnectorhq.com';

const headers = () => ({
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
  Accept: 'application/json'
});

// Custom-field definitions rarely change; cache them in memory for 10 min so
// repeated scoring runs don't re-hit GHL for the field dictionary every time.
let _defsCache = null;
let _defsCachedAtMs = 0;
const DEFS_TTL_MS = 10 * 60 * 1000;

async function getCustomFieldDefs() {
  const nowMs = Date.now();
  if (_defsCache && _defsCache.length && nowMs - _defsCachedAtMs < DEFS_TTL_MS) return _defsCache;

  const res = await axios.get(`${GHL_BASE}/locations/${GHL_LOCATION_ID}/customFields`, { headers: headers() });
  const defs = res.data.customFields || [];
  // Never cache an empty/garbage result — a transient empty response would
  // otherwise blank every field name for 10 min and score everyone 0.
  if (!Array.isArray(defs) || defs.length === 0) {
    throw new Error('GHL returned no custom field definitions');
  }
  _defsCache = defs;
  _defsCachedAtMs = nowMs;
  return _defsCache;
}

// Names of custom fields that must NEVER reach the AI (secrets / portal plumbing).
const SENSITIVE_NAME_HINTS = [
  'password', 'pwd', 'passcode', 'passphrase', 'reset_password_url', 'reset url',
  'admin_message', 'invite_link', 'invite link', 'token', 'secret', 'api key',
  'apikey', 'private key', 'credential', 'bearer', 'otp', 'mfa', ' pin', 'pin '
];

function isSensitive(def) {
  const key = `${def?.name || ''} ${def?.fieldKey || ''}`.toLowerCase();
  return SENSITIVE_NAME_HINTS.some(h => key.includes(h));
}

// Belt-and-braces value scrub: redact anything that LOOKS like a secret before
// it leaves our system for Groq (a third party), regardless of field name.
const SECRET_VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /https?:\/\/\S*(?:token|reset|invite)=\S+/gi,                     // tokenised links
  /\b[A-Za-z0-9_-]{32,}\b/g                                         // long high-entropy strings / API keys
];
function scrubSecrets(value) {
  let v = String(value);
  for (const re of SECRET_VALUE_PATTERNS) v = v.replace(re, '[REDACTED]');
  return v;
}

// Normalise a raw GHL custom-field value (string, array, or file-upload object)
// into { value, fileUrl, fileUrls, fileMeta }. Secrets are scrubbed from text.
function normaliseValue(raw) {
  if (raw == null) return { value: '', fileUrl: null, fileUrls: [], fileMeta: null };

  if (typeof raw === 'object') {
    if (Array.isArray(raw)) return { value: scrubSecrets(raw.join(', ')), fileUrl: null, fileUrls: [], fileMeta: null };
    // A multi-file upload is an object keyed by file id; collect EVERY url.
    const fileEntries = Object.values(raw).filter(v => v && v.url);
    if (fileEntries.length) {
      const urls = fileEntries.map(v => v.url);
      return { value: '', fileUrl: urls[0], fileUrls: urls, fileMeta: fileEntries[0].meta || {} };
    }
    return { value: scrubSecrets(JSON.stringify(raw)), fileUrl: null, fileUrls: [], fileMeta: null };
  }
  return { value: scrubSecrets(raw), fileUrl: null, fileUrls: [], fileMeta: null };
}

// Fetch a contact and return { contact, fields } where fields is the enriched
// list: [{ id, name, dataType, value, fileUrl, fileMeta }] with secrets removed.
async function getEnrichedContact(contactId) {
  const [defs, contactRes] = await Promise.all([
    getCustomFieldDefs(),
    axios.get(`${GHL_BASE}/contacts/${contactId}`, { headers: headers() }).catch(e => {
      // GHL returns 400/404 for a bad/unknown id — normalise so callers 404.
      if ([400, 404].includes(e.response?.status)) throw new Error('Contact not found');
      throw e;
    })
  ]);

  const contact = contactRes.data.contact;
  if (!contact) throw new Error('Contact not found');

  const raw = contact.customFields || [];
  const fields = raw
    .map(f => {
      const def = defs.find(d => d.id === f.id);
      if (def && isSensitive(def)) return null;
      const { value, fileUrl, fileUrls, fileMeta } = normaliseValue(f.value);
      return {
        id: f.id,
        name: (def ? def.name : f.id || '').trim(),
        dataType: def ? def.dataType : 'TEXT',
        value,
        fileUrl,
        fileUrls,
        fileMeta
      };
    })
    .filter(Boolean);

  return { contact, fields };
}

// Append a note to the contact's GHL activity log (used to record AI runs).
async function addNote(contactId, body) {
  return axios.post(`${GHL_BASE}/contacts/${contactId}/notes`, { body }, { headers: headers() });
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024; // 15 MB cap per evidence file

// Download a file URL into a Buffer. GHL-hosted documents need the API key;
// public CDN/signed URLs do not. Returns null on any failure (never throws).
async function downloadFile(url) {
  if (!url || typeof url !== 'string') return null;
  const useAuth = /leadconnectorhq\.com/i.test(url);
  const opts = {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
    headers: useAuth ? { Authorization: `Bearer ${GHL_API_KEY}` } : {}
  };
  try {
    const res = await axios.get(url, opts);
    return Buffer.from(res.data);
  } catch (e) {
    // Retry GHL URLs without auth (and vice-versa) in case our guess was wrong.
    try {
      const res = await axios.get(url, { ...opts, headers: useAuth ? {} : { Authorization: `Bearer ${GHL_API_KEY}` } });
      return Buffer.from(res.data);
    } catch (e2) {
      return null;
    }
  }
}

module.exports = { getEnrichedContact, getCustomFieldDefs, addNote, downloadFile };
