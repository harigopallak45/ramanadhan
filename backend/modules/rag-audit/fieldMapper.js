// =====================================================================
// Maps enriched GHL custom fields onto the live evidence areas (the
// built-in Q01–Q23 PLUS any questions the admin has added since).
// This is the server-side twin of resolveFieldInfo() in the frontend
// (entity.html / audit.html) so scoring uses the SAME mapping the auditor
// sees on screen.
//
// Two resolution paths, by design:
//   - EXACT: a question with a provisioned GHL `fieldId` (any admin-added
//     question, and any built-in the admin has since pinned) matches its
//     field by id — no guessing.
//   - FUZZY: the original 23 built-ins still resolve via the historical
//     title/keyword matcher below, because real client data already lives
//     in GHL fields that predate this app and were never renamed to match
//     cleanly. This path is intentionally left untouched.
// =====================================================================
const questionBank = require('./questionBank');
const fileNames = require('./fileNames');

// Always read the LIVE list — admin edits must take effect on the very
// next request, not after a restart.
function activeQuestions() { return questionBank.listActive(); }

// Generic GHL/CRM field names that must NEVER be treated as audit evidence,
// even though they contain a keyword (e.g. "Employee count" vs the audit's
// "Q17_employee_count"). Real audit fields use an explicit Qxx prefix, which
// is matched first, so this only guards the fuzzy keyword fallback.
const GENERIC_FIELDS = new Set([
  'employee count', 'position', 'rating', 'cms', 'subject',
  'facebook pixel', 'google my business', 'google tag manager', 'google analytics',
  'linkedin_url', 'facebook_url', 'instagram_url', 'youtube_url', 'twitter_url',
  'are you a member of an industry group'
]);

// Whole-word keyword test (so "app" doesn't match "Appointment", "edd" doesn't
// match "embedded", "cash" doesn't match "cashflow forecast", etc.).
function hasWord(haystack, word) {
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(haystack);
}

// Resolve a single field's name to a Qxx id: explicit "Q03" prefix →
// semantic title match → guarded whole-word keyword fallback.
function resolveQId(name) {
  const clean = String(name || '').trim();
  const lower = clean.toLowerCase();
  const known = new Set(activeQuestions().map(q => q.id));

  // 1. Explicit Qxx prefix, for any question that actually exists (built-in
  //    or admin-added) — this is what real audit fields use.
  const qMatch = clean.match(/Q(?:uestion)?\s*0*(\d+)/i);
  if (qMatch) {
    const id = 'Q' + String(parseInt(qMatch[1], 10)).padStart(2, '0');
    if (known.has(id)) return id;
  }

  // Known generic CRM fields never count as audit evidence.
  if (GENERIC_FIELDS.has(lower)) return 'Q00';

  // 2. Semantic title match against the live question list
  const spec = activeQuestions().find(s => {
    const t = s.title.toLowerCase();
    return lower.includes(t) || t.includes(lower) ||
      t.replace('and', '&').includes(lower.replace('and', '&')) ||
      lower.replace('and', '&').includes(t.replace('and', '&'));
  });
  if (spec) return spec.id;

  // 3. Whole-word keyword fallback. Multi-word phrases preferred; short/ambiguous
  //    tokens (app, pep, edd, acr, npc) require word boundaries to avoid false hits.
  const kw = [
    [['aml/ctf program', 'program policies', 'policies and procedures'], 'Q01'],
    [['fte', 'headcount'], 'Q02'],
    [['training'], 'Q03'],
    [['police', 'clearance', 'npc'], 'Q04'],
    [['jurisdiction', 'delivery channel'], 'Q05'],
    [['transaction list', 'sample month'], 'Q06'],
    [['business profile'], 'Q07'],
    [['amlco'], 'Q08'],
    [['annual compliance report', 'acr'], 'Q09'],
    [['austrac registration', 'renewal'], 'Q10'],
    [['org chart'], 'Q11'],
    [['outsource', 'outsourced'], 'Q12'],
    [['idv', 'sanctions', 'pep screening'], 'Q13'],
    [['cyber', 'information security', 'data protection'], 'Q14'],
    [['edd'], 'Q15'],
    [['smr', 'suspicious matter'], 'Q16'],
    [['periodic due diligence', 'employee file'], 'Q17'],
    [['cash intensity', 'cash handling'], 'Q18'],
    [['onboarding', 'customer onboarding'], 'Q19'],
    [['distribution relationship', 'review cadence'], 'Q20'],
    [['privacy', 'australian privacy'], 'Q21'],
    [['on-site inspection', 'inspection scope'], 'Q22'],
    [['internal review', 'systemic test', 'independent testing'], 'Q23']
  ];
  for (const [terms, id] of kw) {
    if (terms.some(t => (t.includes(' ') ? lower.includes(t) : hasWord(lower, t)))) return id;
  }
  return 'Q00'; // unmapped / general
}

// ── Content-aware classification for AUDITOR uploads ────────────────────────
// Filenames carry no Qxx prefix in the real world ("bank statement.pdf"), so
// we classify each uploaded document by WHAT IT SAYS, using the filename only
// as a strong hint. Each area has weighted keywords: multi-word phrases (3) are
// the most distinctive, distinctive single words (2) less so, generic words (1)
// least. The filename is scored at 2× because naming is intentional.
const CONTENT_KW = {
  Q01: [['aml/ctf program', 3], ['anti-money laundering and counter-terrorism financing program', 3], ['compliance program', 3], ['policies and procedures', 3], ['part a', 2], ['part b', 2], ['designated service', 2]],
  Q02: [['fraud/financial crime compliance', 3], ['financial crime compliance', 3], ['headcount', 2], ['fte', 2], ['compliance staff', 2], ['number of employees', 2]],
  Q03: [['training sheet', 4], ['employee training', 4], ['staff training', 3], ['training schedule', 3], ['training log', 3], ['training agenda', 3], ['induction', 2], ['training', 2], ['attendance', 2], ['certificate of training', 3], ['workshop', 1]],
  Q04: [['national police', 3], ['police clearance', 3], ['clearance certificate', 3], ['background check', 2], ['npc', 2], ['police', 1]],
  Q05: [['delivery channel', 3], ['jurisdiction', 2], ['countries you have services', 3], ['remittance corridor', 3], ['high-risk countries', 2]],
  Q06: [['transaction list', 4], ['transaction details', 4], ['transaction monitoring', 4], ['remittance type', 3], ['receiver full name', 3], ['sender full name', 3], ['monitoring system', 2], ['swift', 1]],
  Q07: [['risk assessment', 3], ['business profile', 3], ['ml/tf risk', 3], ['risk register', 3], ['enterprise risk', 2], ['likelihood', 1], ['impact score', 2]],
  Q08: [['compliance officer', 3], ['amlco', 3], ['mlro', 2], ['responsible manager', 3], ['curriculum vitae', 3], ['career history', 4], ['compliance & risk professional', 4], ['resume', 2], ['area of expertise', 3]],
  Q09: [['annual compliance report', 3], ['compliance report', 2], ['acr', 2]],
  Q10: [['austrac registration', 3], ['austrac enrolment', 3], ['enrolment', 2], ['remittance registration', 3], ['independent remitter dealer number', 3], ['registration certificate', 3], ['asic', 2], ['company extract', 2], ['acn', 1]],
  Q11: [['org chart', 4], ['organisational chart', 4], ['organizational chart', 4], ['reporting lines', 2], ['board of directors', 2]],
  Q12: [['outsourcing', 3], ['outsourced', 3], ['service agreement', 3], ['sla', 2], ['third party', 2], ['service level', 2]],
  Q13: [['identity verification', 3], ['id verification', 3], ['politically exposed', 3], ['pep screening', 3], ['sanctions', 2], ['sanction', 2], ['membercheck', 3], ['cloudcheck', 3], ['idv', 2], ['screening', 2], ['equifax', 3], ['lexisnexis', 3], ['bureau charges', 2]],
  Q14: [['information security', 3], ['cyber', 2], ['cybersecurity', 3], ['data protection', 3], ['incident response', 3], ['access control', 3], ['encryption', 2], ['data breach', 2]],
  Q15: [['enhanced due diligence', 3], ['enhanced customer due diligence', 3], ['ecdd', 2], ['edd', 2], ['case file', 2], ['investigation', 2], ['high-risk customer', 2]],
  Q16: [['suspicious matter report', 3], ['suspicious matter', 3], ['suspicious transaction', 3], ['nil return', 3], ['smr', 2]],
  Q17: [['employee due diligence', 3], ['employee file', 3], ['re-screening', 3], ['periodic due diligence', 3], ['staff file', 2]],
  Q18: [['threshold transaction', 3], ['cash intensity', 3], ['cash handling', 3], ['ttr', 2], ['physical currency', 2]],
  Q19: [['customer onboarding', 3], ['customer identification', 3], ['customer due diligence', 3], ['know your customer', 3], ['onboarding', 2], ['kyc', 2], ['cdd', 2], ['applicable customer identification', 3]],
  Q20: [['distribution relationship', 3], ['agent relationship', 3], ['sub-agent', 2], ['distributor', 2], ['affiliate', 2], ['review cadence', 2]],
  Q21: [['australian privacy principles', 3], ['privacy policy', 3], ['privacy act', 3], ['privacy', 2]],
  Q22: [['on-site inspection', 3], ['onsite inspection', 3], ['site visit', 3], ['inspection scope', 3], ['premises inspection', 3]],
  Q23: [['independent review', 4], ['external review', 4], ['internal review', 4], ['internal audit', 4], ['systemic test', 3], ['review report', 2]]
};

function scoreAgainst(haystack, kwList) {
  let s = 0;
  for (const [phrase, w] of kwList) {
    const hit = phrase.includes(' ') ? haystack.includes(phrase) : hasWord(haystack, phrase);
    if (hit) s += w;
  }
  return s;
}

// Classify one uploaded document to a review area from its filename + contents.
// Returns a Qxx id, or 'Q00' if nothing scores high enough (genuinely unmatched).
function classifyUpload(name = '', text = '') {
  const known = new Set(activeQuestions().map(q => q.id));

  // 1. An explicit Qxx in the filename always wins — the auditor named it on purpose.
  const explicit = String(name).match(/Q(?:uestion)?\s*0*(\d+)/i);
  if (explicit) {
    const id = 'Q' + String(parseInt(explicit[1], 10)).padStart(2, '0');
    if (known.has(id)) return id;
  }
  // 2. Score the contents (and filename, weighted 2×) against every area. The
  //    static CONTENT_KW table covers the 23 built-ins; admin-added questions
  //    contribute their own `keywords` at equal weight (2 = "distinctive word").
  const fname = String(name).toLowerCase();
  const body = String(text).toLowerCase().slice(0, 8000);
  let best = 'Q00', bestScore = 0;
  for (const q of activeQuestions()) {
    const table = CONTENT_KW[q.id] || (q.keywords || []).map(k => [String(k).toLowerCase(), 2]);
    if (!table.length) continue;
    const score = scoreAgainst(fname, table) * 2 + scoreAgainst(body, table);
    if (score > bestScore) { bestScore = score; best = q.id; }
  }
  // 3. Require a minimum of one strong phrase (or a couple of weak hits) to assign.
  return bestScore >= 3 ? best : 'Q00';
}

function looksLikeFile(field) {
  if (field.fileUrl) return true;
  if (field.dataType === 'FILE_UPLOAD') return true;
  const v = String(field.value || '').toLowerCase();
  if (!v.includes('http')) return false;
  return v.includes('/documents/download/') ||
    // Our own evidence-upload endpoint stores files on GHL's asset CDN —
    // any URL there is evidence regardless of extension.
    v.includes('filesafe.space') ||
    /\.(pdf|jpe?g|png|webp|gif|csv|xlsx?|docx?|doc|txt|rtf|zip)\b/.test(v);
}

// Group enriched fields into one bucket per review area. Each question may
// now map to SEVERAL real GHL fields (fields[] — e.g. Q08 = AMLCO name +
// certification + CV upload), so resolution is exact-id only: every active
// question's fields[].ghlFieldId is known up front (Sentinel built-ins) or
// was provisioned on first use (admin-added questions) — no more fuzzy name
// guessing for the structured intake path (fuzzy matching stays in
// resolveQId/classifyUpload below, which serve the auditor's separate
// free-form "upload & analyze" flow).
// Returns: { Q01: { id, section, title, weight, critical,
//   fields: [{ key, label, inputType, options, value, files:[{name,url}] }],
//   answers:[str], files:[{name,url}] } }  — answers/files are a flattened
// view across all sub-fields, kept for scorer.js's existing prompt assembly.
function groupResponses(fields) {
  const specs = activeQuestions();
  const groups = {};
  const byFieldId = new Map(); // ghlFieldId -> { qId, subKey }

  for (const spec of specs) {
    const subFields = (spec.fields || []).map(f => ({
      key: f.key, label: f.label, inputType: f.inputType, options: f.options || null,
      value: '', files: []
    }));
    groups[spec.id] = {
      id: spec.id, section: spec.section, title: spec.title,
      weight: spec.weight, critical: spec.critical,
      adequacy: spec.adequacy, efficacy: spec.efficacy,
      fields: subFields,
      answers: [], files: []
    };
    for (const f of (spec.fields || [])) {
      if (f.ghlFieldId) byFieldId.set(f.ghlFieldId, { qId: spec.id, subKey: f.key });
    }
  }

  for (const f of fields) {
    const hit = byFieldId.get(f.id);
    if (!hit) continue; // no match to any active question's sub-field
    const group = groups[hit.qId];
    const subField = group.fields.find(sf => sf.key === hit.subKey);
    if (!subField) continue;

    if (subField.inputType === 'file' || looksLikeFile(f)) {
      // Prefer fileEntries — each file paired with ITS OWN meta, so a field
      // with several files doesn't have every file show the first file's
      // name. Fall back to plain fileUrls (no per-file meta available) or a
      // regex pull from a joined string (our older LARGE_TEXT evidence trick).
      let entries = (f.fileEntries && f.fileEntries.length)
        ? f.fileEntries
        : ((f.fileUrls && f.fileUrls.length) ? f.fileUrls : [f.fileUrl]).filter(Boolean).map(u => ({ url: u, meta: {} }));
      if (!entries.length) entries = (String(f.value || '').match(/https?:\/\/\S+/g) || []).map(u => ({ url: u, meta: {} }));
      entries.forEach(({ url: u, meta }) => {
        // GHL's own per-file metadata first (native to uploads made through
        // the dedicated custom-field upload endpoint); our local fileNames.js
        // sidecar next (covers legacy plain-URL-array uploads with no meta
        // at all); the raw GHL field name (e.g. "Q01_program_files") last.
        const originalName = (meta && meta.originalname) || fileNames.get(u) || '';
        const entry = { name: f.name, url: u, originalName, mimetype: (meta && meta.mimetype) || '' };
        subField.files.push(entry);
        group.files.push(entry);
      });
    } else if (String(f.value || '').trim() !== '') {
      subField.value = String(f.value).trim();
      group.answers.push(`${subField.label}: ${subField.value}`);
    }
  }
  return groups;
}

// Build an empty group skeleton (one bucket per review area).
function emptyGroups() {
  const groups = {};
  for (const spec of activeQuestions()) {
    groups[spec.id] = {
      id: spec.id, section: spec.section, title: spec.title,
      weight: spec.weight, critical: spec.critical,
      adequacy: spec.adequacy, efficacy: spec.efficacy,
      answers: [], files: [], docs: []
    };
  }
  return groups;
}

// For the auditor's direct upload: assign each parsed file to a review area by
// its filename (e.g. "Q06-transactions.pdf" or "training-schedule.pdf"). Files
// whose name doesn't map are returned as `unmatched` so the auditor can rename.
function assignUploadsToGroups(parsedFiles) {
  const groups = emptyGroups();
  const unmatched = [];
  for (const p of parsedFiles) {
    // Classify by CONTENT + filename (not filename alone) so human-named files
    // like "bank statement.pdf" still land in the right review area.
    const qId = classifyUpload(p.name, p.text);
    if (groups[qId]) {
      groups[qId].files.push({ name: p.name });
      groups[qId].docs.push({ name: p.name, ok: p.ok, note: p.note, text: p.text });
    } else {
      unmatched.push(p.name);
    }
  }
  return { groups, unmatched };
}

module.exports = { resolveQId, classifyUpload, groupResponses, emptyGroups, assignUploadsToGroups };
