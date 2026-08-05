// =====================================================================
// QUESTION BANK — the admin-editable, single source of truth for the
// evidence areas the AI scorer grades and the client intake form renders.
//
// Seeded once from the reform RUBRIC in rubric.js, then persisted to
// questions.json and owned by the admin from there on — code changes to
// rubric.js after the first boot no longer affect a deployment that has
// already seeded (admin edits must never be silently overwritten).
//
// Every question maps to a CONCRETE GHL custom field:
//   - The 23 built-in questions map to already-existing GHL fields via the
//     legacy fuzzy resolver in fieldMapper.js (real client data already
//     lives there — never touch that resolution path).
//   - Any question added/edited from the admin UI gets its OWN GHL custom
//     field auto-provisioned via ghl.createCustomField(), and its `fieldId`
//     is stored right here — so reads/writes for new questions are a
//     direct id lookup, no fuzzy matching needed.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { RUBRIC: DEFAULT_RUBRIC } = require('./rubric');
const { getSentinelFields } = require('./sentinelFields');

const STORE_PATH = path.join(__dirname, 'questions.json');

const INPUT_TYPES = ['text', 'textarea', 'file', 'number', 'date', 'radio', 'select', 'phone', 'monetary', 'checkbox'];

// Accepts an array or a comma-separated string (the admin UI's "options"
// field, same convention as `keywords`) and returns a clean string array.
function parseOptions(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return list.map((s) => String(s).trim()).filter(Boolean);
}

// A question maps to one or more CONCRETE GHL fields via `fields[]`:
//   [{ key, label, inputType, ghlFieldId, ghlFieldKey, options? }]
// Built-ins with a known area in the pre-existing "Sentinel rrs" GHL folder
// (sentinelFields.js — created 2026-04-23, before this app provisioned
// anything itself) get that folder's real, purpose-typed fields verbatim —
// e.g. Q08 becomes 3 fields: AMLCO name / certification / CV upload, not one
// blob. A question with no Sentinel mapping (custom, admin-added) gets a
// single 'value' field, auto-provisioned on first use via resolveTargetField
// in routes.js.
function defaultFieldsFor(qId, fallbackInputType) {
  const sentinel = getSentinelFields(qId);
  if (sentinel) return sentinel.map(f => ({ ...f, ghlFieldId: f.ghlFieldId, ghlFieldKey: f.ghlFieldKey }));
  return [{ key: 'value', label: 'Answer', inputType: fallbackInputType || 'file', ghlFieldId: null, ghlFieldKey: null }];
}

function seedDefaults() {
  return DEFAULT_RUBRIC.map((q, i) => ({
    id: q.id,
    section: q.section,
    title: q.title,
    weight: 1, // every question counts equally — no per-question materiality weighting
    critical: !!q.critical,
    adequacy: q.adequacy,
    efficacy: q.efficacy,
    fields: defaultFieldsFor(q.id, 'file'),
    keywords: [],             // extra content-classifier hints (admin-added only)
    order: i,
    builtin: true,
    archived: false,
    createdAt: null,
    updatedAt: null
  }));
}

// One-time upgrade for a questions.json written before `fields[]` existed
// (flat inputType/fieldId/fieldKey per question). Builtins with a Sentinel
// mapping switch to those real fields; anything else keeps its previously
// pinned single field (if any) wrapped as fields: [{ key: 'value', ... }] so
// no already-answered data goes missing.
function migrateToFieldsSchema(list) {
  let changed = false;
  const migrated = list.map(q => {
    if (Array.isArray(q.fields)) return q;
    changed = true;
    const sentinel = getSentinelFields(q.id);
    const fields = sentinel
      ? sentinel.map(f => ({ ...f }))
      : [{ key: 'value', label: 'Answer', inputType: q.inputType || 'file', ghlFieldId: q.fieldId || null, ghlFieldKey: q.fieldKey || null }];
    const { inputType, fieldId, fieldKey, ...rest } = q;
    return { ...rest, fields };
  });
  return { migrated, changed };
}

// One-time: every question counts equally now — no more per-question
// materiality weight to keep summed to 100. Existing questions.json still
// has the old varied weights (9, 2, 5, ...) from before this decision;
// normalise them all to 1 so old and newly-added questions score the same way.
function migrateWeights(list) {
  let changed = false;
  const migrated = list.map(q => {
    if (q.weight === 1) return q;
    changed = true;
    return { ...q, weight: 1 };
  });
  return { migrated, changed };
}

function load() {
  if (!fs.existsSync(STORE_PATH)) {
    const seeded = seedDefaults();
    save(seeded);
    return seeded;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!Array.isArray(raw) || !raw.length) throw new Error('empty store');
    let list = raw;
    const fieldsMigration = migrateToFieldsSchema(list);
    if (fieldsMigration.changed) {
      console.log('[questionBank] Upgraded questions.json to the fields[] schema (Sentinel rrs mapping applied).');
      list = fieldsMigration.migrated;
    }
    const weightMigration = migrateWeights(list);
    if (weightMigration.changed) {
      console.log('[questionBank] Normalised all question weights to 1 (equal weighting, no more weight system).');
      list = weightMigration.migrated;
    }
    if (fieldsMigration.changed || weightMigration.changed) save(list);
    return list;
  } catch (e) {
    console.error('[questionBank] questions.json unreadable, reseeding from rubric.js defaults:', e.message);
    const seeded = seedDefaults();
    save(seeded);
    return seeded;
  }
}

function save(list) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// In-memory cache, invalidated on every write — admin edits apply to the
// very next score/request with NO server restart required.
let _cache = null;
function all() {
  if (!_cache) _cache = load();
  return _cache;
}
function invalidate() { _cache = null; }

// ---- Reads --------------------------------------------------------------

// Active questions, in display/scoring order. This is what scorer.js and
// fieldMapper.js treat as "the rubric" — swap-in replacement for the old
// static RUBRIC export.
// `onlyIds`: optional array of qIds — when given, further restricts the
// result to that subset (used for per-client question assignment). null/
// undefined means no restriction, matching every existing caller.
function listActive(onlyIds) {
  const active = all().filter(q => !q.archived).sort((a, b) => a.order - b.order);
  if (!Array.isArray(onlyIds)) return active;
  const allow = new Set(onlyIds);
  return active.filter(q => allow.has(q.id));
}

function listAll() {
  return all().slice().sort((a, b) => a.order - b.order);
}

function getById(id) {
  return all().find(q => q.id === id) || null;
}

function nextId() {
  const nums = all()
    .map(q => /^Q(\d+)$/i.exec(q.id))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return 'Q' + String(next).padStart(2, '0');
}

function weightTotal() {
  return listActive().reduce((s, q) => s + (Number(q.weight) || 0), 0);
}

// ---- Validation -----------------------------------------------------------

function validate(input, { isNew }) {
  const errors = [];
  if (!input.title || !String(input.title).trim()) errors.push('title is required');
  if (!input.section || !String(input.section).trim()) errors.push('section is required');
  // New custom questions take a single flat `inputType` from the admin UI
  // (wrapped into fields[] below) — multi-field questions are Sentinel
  // built-ins only and aren't hand-authored through this validator.
  if (input.inputType && !INPUT_TYPES.includes(input.inputType)) errors.push(`inputType must be one of: ${INPUT_TYPES.join(', ')}`);
  if (isNew && input.id) {
    if (!/^Q\d{2,}$/i.test(input.id)) errors.push('id must look like "Q24"');
    if (all().some(q => q.id.toUpperCase() === String(input.id).toUpperCase())) errors.push(`id ${input.id} already exists`);
  }
  return errors;
}

// ---- Writes ---------------------------------------------------------------
// provisionField: async (question) => { fieldId, fieldKey } | null — injected
// by routes.js so this module has no direct GHL dependency (keeps it testable
// and keeps the "who calls the live GHL write API" decision explicit at the
// call site, not buried in a data-layer module).

async function addQuestion(input, provisionField) {
  const errors = validate(input, { isNew: true });
  if (errors.length) { const e = new Error(errors.join('; ')); e.status = 400; throw e; }

  const list = all();
  const id = /^Q\d{2,}$/i.test(input.id || '') ? input.id.toUpperCase() : nextId();
  const now = input.__now || new Date().toISOString();

  const question = {
    id,
    section: String(input.section).trim(),
    title: String(input.title).trim(),
    weight: 1, // every question counts equally
    critical: !!input.critical,
    adequacy: String(input.adequacy || '').trim() || 'Evidence for this area is documented.',
    efficacy: String(input.efficacy || '').trim() || 'Evidence proves the control actually operates.',
    fields: [{
      key: 'value', label: 'Answer', inputType: input.inputType || 'file', ghlFieldId: null, ghlFieldKey: null,
      options: ['radio', 'select'].includes(input.inputType) ? parseOptions(input.options) : undefined
    }],
    keywords: Array.isArray(input.keywords) ? input.keywords.map(String) : [],
    order: Number.isFinite(input.order) ? input.order : list.length,
    builtin: false,
    archived: false,
    createdAt: now,
    updatedAt: now
  };

  if (typeof provisionField === 'function') {
    const provisioned = await provisionField(question, question.fields[0]);
    if (provisioned) {
      question.fields[0].ghlFieldId = provisioned.fieldId || null;
      question.fields[0].ghlFieldKey = provisioned.fieldKey || null;
    }
  }

  list.push(question);
  save(list);
  invalidate();
  return question;
}

async function updateQuestion(id, patch) {
  const list = all();
  const idx = list.findIndex(q => q.id === id);
  if (idx === -1) { const e = new Error(`question ${id} not found`); e.status = 404; throw e; }

  const merged = { ...list[idx], ...patch, id: list[idx].id, builtin: list[idx].builtin };
  const errors = validate(merged, { isNew: false });
  if (errors.length) { const e = new Error(errors.join('; ')); e.status = 400; throw e; }

  merged.updatedAt = patch.__now || new Date().toISOString();
  list[idx] = merged;
  save(list);
  invalidate();
  return merged;
}

// Soft-delete only — a question that scored real evidence in the past must
// stay resolvable so historical scorecards don't break; archived questions
// are just hidden from new forms/scoring.
function archiveQuestion(id) {
  const list = all();
  const idx = list.findIndex(q => q.id === id);
  if (idx === -1) { const e = new Error(`question ${id} not found`); e.status = 404; throw e; }
  list[idx].archived = true;
  list[idx].updatedAt = new Date().toISOString();
  save(list);
  invalidate();
  return list[idx];
}

function restoreQuestion(id) {
  const list = all();
  const idx = list.findIndex(q => q.id === id);
  if (idx === -1) { const e = new Error(`question ${id} not found`); e.status = 404; throw e; }
  list[idx].archived = false;
  list[idx].updatedAt = new Date().toISOString();
  save(list);
  invalidate();
  return list[idx];
}

function reorder(orderedIds) {
  const list = all();
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  for (const q of list) {
    if (pos.has(q.id)) q.order = pos.get(q.id);
  }
  save(list);
  invalidate();
  return listAll();
}

module.exports = {
  INPUT_TYPES,
  listActive,
  listAll,
  getById,
  nextId,
  weightTotal,
  addQuestion,
  updateQuestion,
  archiveQuestion,
  restoreQuestion,
  reorder,
  invalidate
};
