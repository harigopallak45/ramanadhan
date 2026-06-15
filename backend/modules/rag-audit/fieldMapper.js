// =====================================================================
// Maps enriched GHL custom fields onto the 23 review areas (Q01–Q23).
// This is the server-side twin of resolveFieldInfo() in the frontend
// (entity.html / audit.html) so scoring uses the SAME mapping the auditor
// sees on screen.
// =====================================================================
const { RUBRIC } = require('./rubric');

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

  // 1. Explicit Q01–Q23 prefix (this is what real audit fields use)
  const qMatch = clean.match(/Q(?:uestion)?\s*(\d+)/i);
  if (qMatch) {
    const num = parseInt(qMatch[1], 10);
    if (num >= 1 && num <= 23) return 'Q' + String(num).padStart(2, '0');
  }

  // Known generic CRM fields never count as audit evidence.
  if (GENERIC_FIELDS.has(lower)) return 'Q00';

  // 2. Semantic title match against the rubric
  const spec = RUBRIC.find(s => {
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

function looksLikeFile(field) {
  if (field.fileUrl) return true;
  if (field.dataType === 'FILE_UPLOAD') return true;
  const v = String(field.value || '').toLowerCase();
  return v.includes('http') && (
    v.includes('/documents/download/') ||
    /\.(pdf|jpe?g|png|webp|gif|csv|xlsx?|docx?|zip)\b/.test(v)
  );
}

// Group enriched fields into one bucket per review area.
// Returns: { Q01: { id, section, title, weight, critical, answers:[str], files:[{name,url}] }, ... }
function groupResponses(fields) {
  const groups = {};
  for (const spec of RUBRIC) {
    groups[spec.id] = {
      id: spec.id, section: spec.section, title: spec.title,
      weight: spec.weight, critical: spec.critical,
      adequacy: spec.adequacy, efficacy: spec.efficacy,
      answers: [], files: []
    };
  }

  for (const f of fields) {
    const qId = resolveQId(f.name);
    if (!groups[qId]) continue; // drops Q00 / unmapped general profile noise

    if (looksLikeFile(f)) {
      const urls = (f.fileUrls && f.fileUrls.length) ? f.fileUrls : [f.fileUrl || f.value];
      const meta = f.fileMeta || {};
      urls.forEach(u => groups[qId].files.push({
        name: f.name, url: u,
        originalName: meta.originalname || '',
        mimetype: meta.mimetype || ''
      }));
    } else if (String(f.value || '').trim() !== '') {
      groups[qId].answers.push(`${f.name}: ${String(f.value).trim()}`);
    }
  }
  return groups;
}

// Build an empty group skeleton (one bucket per review area).
function emptyGroups() {
  const groups = {};
  for (const spec of RUBRIC) {
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
    const qId = resolveQId(p.name);
    if (groups[qId]) {
      groups[qId].files.push({ name: p.name });
      groups[qId].docs.push({ name: p.name, ok: p.ok, note: p.note, text: p.text });
    } else {
      unmatched.push(p.name);
    }
  }
  return { groups, unmatched };
}

module.exports = { resolveQId, groupResponses, emptyGroups, assignUploadsToGroups };
