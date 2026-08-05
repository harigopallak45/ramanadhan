// =====================================================================
// Persists the ORIGINAL filename a client/admin uploaded, keyed by the GHL
// media URL it landed at. GHL's FILE_UPLOAD custom fields only ever store
// the URL (confirmed empirically — a plain array of strings, no filename
// alongside it), so without this, every viewer of an uploaded file sees the
// raw GHL field name (e.g. "Q01_program_files") instead of what the file is
// actually called. URLs are globally unique (GHL's media CDN mints a UUID
// per upload), so a flat url -> name map needs no contact/field scoping.
// =====================================================================
const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'file-names.json');

let _cache = null;
function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (_) {
    _cache = {};
  }
  return _cache;
}

function save(map) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(map, null, 2), 'utf8');
}

function get(url) {
  return load()[url] || null;
}

function set(url, name) {
  if (!url || !name) return;
  const map = load();
  map[url] = name;
  save(map);
}

module.exports = { get, set };
