// =====================================================================
// LOCAL FILE BACKUP — a copy of every uploaded evidence file, filed on the
// VentraIP server's own disk as client/year/question, purely for the
// operator's own filing/backup. GHL stays the real source of truth (the
// upload route writes there first via uploadCustomFieldFile) — this never
// runs instead of that, only alongside it, and a failure here never fails
// the upload response back to the client.
// =====================================================================
const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Windows/cross-platform-unsafe characters stripped, trimmed to a sane
// length — folder and file names both go through this.
function sanitizeName(s, fallback) {
  const clean = String(s || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').slice(0, 100);
  return clean || fallback;
}

function clientFolderName(contact) {
  const business = contact?.companyName && String(contact.companyName).trim();
  if (business) return sanitizeName(business, contact.id);
  const person = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim();
  return sanitizeName(person, contact?.id || 'Unknown Client');
}

// filenameHint: the question-scoped name to prefix the original filename
// with, e.g. "Q17" for a single-field question, "Q06_Transaction list" for
// one sub-field of a multi-field question — matches the
// Organized_By_Question/<Client>/<QId>_<Description>.<ext> convention
// already used for this client's evidence.
function saveLocalCopy({ contact, filenameHint, buffer, originalFilename, uploadedAt }) {
  try {
    const year = String((uploadedAt || new Date()).getFullYear());
    const dir = path.join(UPLOADS_ROOT, clientFolderName(contact), year);
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(originalFilename || '');
    const base = sanitizeName(path.basename(originalFilename || '', ext), 'file');
    let filename = `${sanitizeName(filenameHint, 'Q')}_${base}${ext}`;
    let dest = path.join(dir, filename);
    // Never silently overwrite a same-named prior upload — suffix instead.
    let n = 2;
    while (fs.existsSync(dest)) {
      filename = `${sanitizeName(filenameHint, 'Q')}_${base} (${n})${ext}`;
      dest = path.join(dir, filename);
      n++;
    }

    fs.writeFileSync(dest, buffer);
    return dest;
  } catch (err) {
    // Local filing is a convenience copy, not the source of truth — never
    // let a disk error here fail the actual (already-succeeded) GHL upload.
    console.error('[localFileBackup] Failed to save local copy:', err.message);
    return null;
  }
}

module.exports = { saveLocalCopy };
