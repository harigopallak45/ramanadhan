// =====================================================================
// Extracts plain text from uploaded evidence documents so the AI can judge
// efficacy from the CONTENTS, not just the filename. Supports PDF, Word,
// Excel/CSV and plain text. Every parser is defensive — a corrupt or
// unsupported file yields a short marker, never a thrown error.
// =====================================================================
const path = require('path');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse'); // v2 class-based API

const MAX_TEXT = 6000; // default cap for evidence docs (keeps prompts bounded)

function extFromName(name = '', mimetype = '') {
  const e = path.extname(String(name)).toLowerCase().replace('.', '');
  if (e) return e;
  if (/pdf/.test(mimetype)) return 'pdf';
  if (/word|docx/.test(mimetype)) return 'docx';
  if (/sheet|excel/.test(mimetype)) return 'xlsx';
  if (/csv/.test(mimetype)) return 'csv';
  if (/text|plain/.test(mimetype)) return 'txt';
  return '';
}

// Identify type from the file's magic bytes — the source of truth when the
// name/mimetype are missing or wrong (GHL field names carry no extension).
function sniffType(buffer) {
  if (!buffer || buffer.length < 4) return '';
  const b = buffer;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';      // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';       // PK.. (docx/xlsx/zip)
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole';       // legacy .doc/.xls
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return '';
}

// A PK-zip could be .docx or .xlsx — peek at the entry names to tell them apart.
function zipFlavour(buffer) {
  const head = buffer.slice(0, 4000).toString('latin1');
  if (head.includes('word/')) return 'docx';
  if (head.includes('xl/')) return 'xlsx';
  if (head.includes('ppt/')) return 'pptx';
  return 'zip';
}

function clean(text, maxChars = MAX_TEXT) {
  return String(text || '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, maxChars);
}

// Parse a file buffer into extracted text. Returns { text, kind, ok, note }.
// opts.maxChars overrides the default cap (knowledge ingestion passes a large value).
async function parseBuffer(buffer, filename = '', mimetype = '', opts = {}) {
  const cap = opts.maxChars || MAX_TEXT;
  if (!buffer || !buffer.length) return { text: '', kind: 'unknown', ok: false, note: 'empty file' };

  // Prefer the name/mimetype, but fall back to magic-byte sniffing — GHL field
  // names like "Q01_program_files" carry no extension.
  let ext = extFromName(filename, mimetype);
  if (!ext || ext === 'unknown') {
    const sniff = sniffType(buffer);
    ext = sniff === 'zip' ? zipFlavour(buffer) : sniff;
  }

  try {
    if (ext === 'pdf') {
      const parser = new PDFParse({ data: buffer });
      let text = '';
      try {
        const data = await parser.getText();
        text = clean(data.text, cap);
      } finally {
        await parser.destroy().catch(() => {});
      }
      // A near-empty PDF text layer usually means a scanned/image PDF.
      if (text.length < 20) return { text, kind: 'pdf', ok: false, note: 'no extractable text (likely scanned image — OCR not enabled)' };
      return { text, kind: 'pdf', ok: true };
    }
    if (ext === 'docx' || ext === 'doc') {
      const { value } = await mammoth.extractRawText({ buffer });
      return { text: clean(value, cap), kind: 'docx', ok: true };
    }
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parts = wb.SheetNames.slice(0, 6).map(n => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
        return `# Sheet: ${n}\n${csv}`;
      });
      return { text: clean(parts.join('\n\n'), cap), kind: ext, ok: true };
    }
    if (ext === 'txt' || ext === 'md' || ext === 'json') {
      return { text: clean(buffer.toString('utf8'), cap), kind: ext, ok: true };
    }
    if (/^(png|jpe?g|gif|webp|bmp|tif?f)$/.test(ext)) {
      return { text: '', kind: ext, ok: false, note: 'image file — contents not read (OCR not enabled)' };
    }
    return { text: '', kind: ext || 'unknown', ok: false, note: `unsupported file type (${ext || 'unknown'})` };
  } catch (e) {
    return { text: '', kind: ext || 'unknown', ok: false, note: `parse error: ${e.message}` };
  }
}

module.exports = { parseBuffer, MAX_TEXT };
