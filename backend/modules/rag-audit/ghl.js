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
  /https?:\/\/\S*(?:token|reset|invite)=\S+/gi                     // tokenised links
];
// Generic "could be an API key" catch-all — long high-entropy string OUTSIDE
// a URL. Deliberately NOT applied to values that are themselves a URL: a
// legitimate document/media link (our own uploaded-evidence URLs, GHL file
// URLs) routinely contains a long UUID/asset-id segment that is not a
// secret — redacting it corrupts the link a client just uploaded.
const GENERIC_SECRET_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;
function scrubSecrets(value) {
  let v = String(value);
  for (const re of SECRET_VALUE_PATTERNS) v = v.replace(re, '[REDACTED]');
  if (!/^https?:\/\//i.test(v.trim())) v = v.replace(GENERIC_SECRET_PATTERN, '[REDACTED]');
  return v;
}

// Normalise a raw GHL custom-field value (string, array, or file-upload object)
// into { value, fileUrl, fileUrls, fileMeta }. Secrets are scrubbed from text.
function normaliseValue(raw) {
  const empty = { value: '', fileUrl: null, fileUrls: [], fileEntries: [], fileMeta: null };
  if (raw == null) return empty;

  if (typeof raw === 'object') {
    if (Array.isArray(raw)) {
      // A real FILE_UPLOAD field stores its value as an array of URL strings
      // (confirmed against GHL directly — NOT the newline-joined string our
      // older LARGE_TEXT-as-evidence-blob trick uses). Only treat it as files
      // when every element actually looks like a URL — a plain multi-select
      // picklist value is also an array, just not of URLs. No per-file
      // metadata exists for this legacy shape (see fileEntries below).
      const urls = raw.filter(v => typeof v === 'string' && /^https?:\/\//.test(v));
      if (urls.length && urls.length === raw.length) {
        return { value: '', fileUrl: urls[0], fileUrls: urls, fileEntries: urls.map(u => ({ url: u, meta: {} })), fileMeta: {} };
      }
      return { ...empty, value: scrubSecrets(raw.join(', ')) };
    }
    // A multi-file upload (GHL's own upload widget / our dedicated
    // upload-custom-files call) is an object keyed by file id — collect
    // EVERY entry with its OWN meta, not just the first one's (a field with
    // 2+ files must not have every file show the first file's name).
    const fileEntries = Object.values(raw).filter(v => v && v.url);
    if (fileEntries.length) {
      const urls = fileEntries.map(v => v.url);
      return {
        value: '', fileUrl: urls[0], fileUrls: urls,
        fileEntries: fileEntries.map(v => ({ url: v.url, meta: v.meta || {} })),
        fileMeta: fileEntries[0].meta || {} // kept for any caller still reading the old single-meta shape
      };
    }
    return { ...empty, value: scrubSecrets(JSON.stringify(raw)) };
  }
  return { ...empty, value: scrubSecrets(raw) };
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
      const { value, fileUrl, fileUrls, fileEntries, fileMeta } = normaliseValue(f.value);
      return {
        id: f.id,
        name: (def ? def.name : f.id || '').trim(),
        dataType: def ? def.dataType : 'TEXT',
        value,
        fileUrl,
        fileUrls,
        fileEntries,
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

// ── Write paths (used by the custom intake form + the admin question builder) ──
// GHL is the system of record here — every write below is a real, persistent
// change to the client's production CRM data. Callers must treat these as
// hard-to-reverse actions, not fire-and-forget.

// Update one or more custom field VALUES on an existing contact.
// updates: [{ id: <ghl custom field id>, value: string }]
async function updateContactFields(contactId, updates) {
  if (!Array.isArray(updates) || !updates.length) return null;
  const res = await axios.put(`${GHL_BASE}/contacts/${contactId}`, {
    customFields: updates
  }, { headers: headers() });
  // A field VALUE write doesn't change the field dictionary, but definitions
  // are cached for 10 min — safe to leave as-is (values aren't cached here).
  return res.data;
}

// Provision a brand-new custom field definition on the location. This is a
// PERSISTENT SCHEMA CHANGE to the client's GHL account — only ever called
// from an explicit admin "add question" action, never automatically/silently.
// dataType: 'TEXT' | 'LARGE_TEXT' | 'NUMERICAL' | 'FILE_UPLOAD' | 'RADIO' ...
async function createCustomField({ name, dataType = 'LARGE_TEXT', placeholder = '' }) {
  const res = await axios.post(`${GHL_BASE}/locations/${GHL_LOCATION_ID}/customFields`, {
    name, dataType, placeholder
  }, { headers: headers() });
  const field = res.data.customField || res.data;
  // Field dictionary just changed — drop the cache so the next read sees it.
  _defsCache = null;
  return { fieldId: field.id, fieldKey: field.fieldKey || field.key || null, raw: field };
}

// Upload a file buffer to the GHL Media Library and return its public URL —
// the standard way to attach evidence to a field via the API (GHL's own file
// custom fields aren't writable with an arbitrary buffer directly).
async function uploadMedia(buffer, filename, mimetype) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimetype });
  // GHL's media library stores this as the item's own name — a durable,
  // GHL-side backup of the original filename (independent of our own
  // fileNames.js sidecar), recoverable later via GET /medias/files even if
  // that local store is ever lost.
  form.append('name', filename);
  const res = await axios.post(`${GHL_BASE}/medias/upload-file`, form, {
    headers: { ...headers(), ...form.getHeaders() },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });
  const url = res.data?.url || res.data?.fileUrl || res.data?.data?.url;
  if (!url) throw new Error('GHL media upload did not return a URL');
  return { url, raw: res.data };
}

// Upload straight to a contact's FILE_UPLOAD custom field via GHL's dedicated
// endpoint — the SAME mechanism GHL's own dashboard upload widget uses. This
// is required, not optional: writing a plain media-library URL into the
// field's value (the generic PUT /contacts path) round-trips fine through
// the API but is invisible in GHL's own UI, because the UI resolves
// FILE_UPLOAD fields from an internal file-record association that only
// this endpoint creates (confirmed empirically + GHL's own changelog).
// IMPORTANT: this endpoint REPLACES the field's entire value with just this
// one file — callers wanting multiple files per field must merge the
// existing value back in afterward (see getRawCustomFields + updateContactFields).
// Returns the new single-entry value object: { [uuid]: { url, meta, documentId } }.
async function uploadCustomFieldFile(contactId, fieldId, buffer, filename, mimetype) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append(fieldId, buffer, { filename, contentType: mimetype });
  const res = await axios.post(`${GHL_BASE}/forms/upload-custom-files`, form, {
    params: { contactId, locationId: GHL_LOCATION_ID },
    headers: { ...headers(), ...form.getHeaders() },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });
  const field = res.data?.contact?.customFields?.find(f => f.id === fieldId);
  if (!field || typeof field.value !== 'object' || Array.isArray(field.value)) {
    throw new Error('GHL custom-field upload did not return the expected file object');
  }
  return field.value;
}

// Raw (unnormalised) customFields straight off the contact — needed when
// merging a new upload back with whatever was already on a FILE_UPLOAD field,
// since the enriched/normalised view getEnrichedContact returns collapses
// the real per-file structure (uuid, meta, documentId) we need to preserve.
async function getRawCustomFields(contactId) {
  const res = await axios.get(`${GHL_BASE}/contacts/${contactId}`, { headers: headers() });
  if (!res.data.contact) throw new Error('Contact not found');
  return res.data.contact.customFields || [];
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

module.exports = {
  getEnrichedContact, getCustomFieldDefs, addNote, downloadFile,
  updateContactFields, createCustomField, uploadMedia,
  uploadCustomFieldFile, getRawCustomFields
};
