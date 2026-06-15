// =====================================================================
// rag-audit routes — auto-mounted by server.js module loader at
//   /api/rag-audit  and  /hlgp/api/rag-audit
//
//   GET  /health             → config + model status (admin)
//   POST /score/:contactId   → AI compliance score + draft report (admin)
//                              ?save=1 also writes a note to the GHL contact
// =====================================================================
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const { getEnrichedContact, addNote } = require('./ghl');
const { groupResponses, assignUploadsToGroups } = require('./fieldMapper');
const { attachDocuments } = require('./evidence');
const { parseBuffer } = require('./docParser');
const { scoreResponses } = require('./scorer');
const { isConfigured, GROQ_MODEL, GroqError } = require('./groq');

const router = express.Router();

// In-memory upload handling for the auditor's direct "drop files & analyse" flow.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 }
});
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail closed: without a real secret, admin tokens would be forgeable.
  console.error('[rag-audit] JWT_SECRET is not set — AI scoring routes will reject all requests.');
}

// Admin-only guard (mirrors server.js adminAuth — token must carry role:'admin').
// Bearer header only — we deliberately do NOT accept ?token= to keep the admin
// JWT out of URLs, logs, and Referer headers.
function adminAuth(req, res, next) {
  if (!JWT_SECRET) return res.status(503).json({ success: false, message: 'Server auth not configured' });
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Not an admin');
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Unauthorized' });
  }
}

router.get('/health', adminAuth, (req, res) => {
  res.json({ success: true, configured: isConfigured(), model: GROQ_MODEL });
});

router.post('/score/:contactId', adminAuth, async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ success: false, message: 'AI scoring is not configured (GROQ_API_KEY missing).' });
  }

  try {
    const { contact, fields } = await getEnrichedContact(req.params.contactId);
    const entityLabel = `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
      + (contact.companyName ? ` (${contact.companyName})` : '');

    const groups = groupResponses(fields);
    // Read the actual contents of every uploaded document (PDF/Word/Excel/…)
    // unless the caller opts out with ?docs=0.
    let docStats = { parsed: 0, failed: 0 };
    if (req.query.docs !== '0') {
      docStats = await attachDocuments(groups);
    }
    const result = await scoreResponses(groups, entityLabel || contact.email || req.params.contactId);
    result.documents = { read: docStats.parsed, unreadable: docStats.failed };

    // Optional: log the run to the GHL contact activity feed.
    if (req.query.save === '1' || req.body?.save === true) {
      try {
        await addNote(
          req.params.contactId,
          `Centinl AI Compliance Score: ${result.score}/100 (${result.rating}). `
          + `${result.criticalFailures} critical gap(s). Model: ${result.model}. `
          + `Draft findings generated for auditor review.`
        );
        result.savedToGhl = true;
      } catch (e) {
        result.savedToGhl = false;
        result.saveError = e.response?.data?.message || e.message;
      }
    }

    res.json({ success: true, result });
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    console.error('[rag-audit SCORE ERROR]:', msg);

    // Map failure classes to honest status codes so the UI can message well.
    let status = 500;
    if (error instanceof GroqError) {
      status = error.kind === 'timeout' ? 504 : (error.kind === 'auth' ? 503 : 502);
    } else if (/Contact not found/i.test(msg)) {
      status = 404;
    } else if (/no custom field definitions/i.test(msg)) {
      status = 502;
    }
    res.status(status).json({ success: false, message: `Scoring failed: ${msg}` });
  }
});

// Auditor uploads documents directly → parse → map to areas → score.
// multipart/form-data: files[] (up to 30), optional entityLabel, optional contactId.
router.post('/analyze-upload', adminAuth, (req, res) => {
  upload.array('files', 30)(req, res, async (uerr) => {
    if (uerr) {
      const tooBig = uerr.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ success: false, message: tooBig ? 'A file exceeds the 15 MB limit.' : `Upload error: ${uerr.message}` });
    }
    if (!isConfigured()) return res.status(503).json({ success: false, message: 'AI scoring is not configured (GROQ_API_KEY missing).' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'No files uploaded.' });

    try {
      const parsed = await Promise.all(files.map(async f => {
        const r = await parseBuffer(f.buffer, f.originalname, f.mimetype);
        return { name: f.originalname, ok: r.ok, note: r.note || '', text: r.text || '' };
      }));

      const { groups, unmatched } = assignUploadsToGroups(parsed);
      const label = (req.body.entityLabel || '').trim() || 'Uploaded evidence';
      const result = await scoreResponses(groups, label);
      result.documents = { read: parsed.filter(p => p.ok && p.text).length, unreadable: parsed.filter(p => !p.ok || !p.text).length };
      result.upload = { files: files.length, matched: files.length - unmatched.length, unmatched };

      if (req.body.contactId) {
        try { await addNote(req.body.contactId, `Centinl AI (uploaded evidence): ${result.score}/100 (${result.rating}). ${files.length} file(s), ${unmatched.length} unmatched.`); }
        catch (e) { /* non-fatal */ }
      }
      res.json({ success: true, result });
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      console.error('[rag-audit UPLOAD ERROR]:', msg);
      const status = (error instanceof GroqError) ? (error.kind === 'timeout' ? 504 : 502) : 500;
      res.status(status).json({ success: false, message: `Analysis failed: ${msg}` });
    }
  });
});

// Log a finished result to the GHL activity feed without re-running the LLM.
router.post('/note/:contactId', adminAuth, async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ success: false, message: 'Note body required' });
  try {
    await addNote(req.params.contactId, body.slice(0, 4000));
    res.json({ success: true, message: 'Logged to GHL activity feed.' });
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    res.status(500).json({ success: false, message: `Failed to log note: ${msg}` });
  }
});

module.exports = router;
