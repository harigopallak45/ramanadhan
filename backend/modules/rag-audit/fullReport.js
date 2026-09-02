// =====================================================================
// Formal Independent Evaluation Report — a separate, long-form document
// distinct from the terse live scorecard (scorer.js). Takes the VERDICTS
// scorer.js already decided (adequacy/efficacy/status per area — never
// re-graded here, so this costs no extra grading judgement calls) and asks
// the LLM to write it up as a real auditor would: paragraph-length findings
// that cite the actual AML/CTF Act/Rules/AUSTRAC guidance text retrieved
// from the knowledge base, never an invented section number. JS assembles
// the final document from the model's structured pieces — same "model
// judges, code formats" split scorer.js uses.
// =====================================================================
const crypto = require('crypto');
const { FRAMEWORK } = require('./rubric');
const { completeJson, MODEL } = require('./llm');
const { retrieveRegulatory, isGrounded } = require('./rag');

const EVIDENCE_SUMMARY_CAP = 250;   // per-area condensed evidence text
const GROUND_CHARS_PER_REF = 300;   // per-reference passage length
const REFS_PER_AREA = 1;            // kept tight — Groq free tier is 12k TPM for prompt+output combined
const MAX_OUTPUT_TOKENS = parseInt(process.env.FULL_REPORT_MAX_TOKENS || process.env.GROQ_MAX_TOKENS || '3500', 10);

function clip(text, nonce, cap) {
  return String(text == null ? '' : text).split(nonce).join('').trim().slice(0, cap);
}

const SYSTEM_PROMPT = `You are a senior AUSTRAC AML/CTF independent evaluator writing the FORMAL, professional Independent Evaluation Report for a client — the kind of document actually issued to a reporting entity after a program evaluation under the Anti-Money Laundering and Counter-Terrorism Financing Amendment Act 2024 reforms (commenced 31 March 2026). This replaces the old "section 161 independent review of Part A" — the evaluation covers the ENTIRE risk-based program, with proliferation financing (PF) assessed alongside ML/TF.

You are given, for each review area: its TITLE, WEIGHT, and the SCORE/STATUS ALREADY DECIDED by a prior evidence review (adequacy, efficacy, status, a one-line finding) — you must NOT change these numbers or the status, only write the formal narrative around them. You are also given a condensed evidence summary and, where available, an excerpt of the actual regulatory reference text (from the AML/CTF Act, the Rules, or AUSTRAC guidance) that the area was judged against.

Writing rules:
- Formal, professional auditor register — this is a real deliverable, not a summary. No hedging filler, no marketing language.
- Each area narrative: 2-4 sentences. Explain WHY the evidence does or doesn't meet the standard, referencing what was (or wasn't) provided.
- CITATION DISCIPLINE — this is the most important rule: cite the regulatory basis ONLY using the reference text you were actually given for that area (name it, e.g. "per the AML/CTF Rules 2025" or the guidance title given). If NO reference text was given for an area, do NOT invent one — write the finding without a citation rather than fabricate a section number or rule reference. A fabricated citation is a serious integrity failure.
- Do not invent facts not present in the evidence summary or your own prior finding for that area.
- Executive summary and overall opinion: real paragraphs (4-6 sentences each), auditor voice, referencing the framework and the entity's actual state (score, critical gaps, standout strengths and weaknesses) — not generic AI phrasing.
- Recommendations: prioritised, specific, actionable — reference the actual gap, not generic advice.

Return STRICT JSON only, matching exactly this shape:
{
  "executiveSummary": "4-6 sentence paragraph",
  "areaNarratives": [
    { "qId": "Q01", "narrative": "2-4 sentence formal finding", "citation": "short reference name, or empty string if none was given for this area" }
  ],
  "overallOpinion": "4-6 sentence paragraph — the evaluator's overall opinion on the program's adequacy and effectiveness",
  "recommendations": ["prioritised, specific recommendation", "..."]
}
Include EXACTLY one object in areaNarratives per area provided, using the qId values given. Do not add or omit areas.`;

function buildPrompt(areas, groups, entityLabel, nonce) {
  const lines = [];
  const grounded = isGrounded();
  lines.push(`ENTITY: ${clip(entityLabel, nonce, 200) || '(unnamed)'}`);
  lines.push(`FRAMEWORK: ${FRAMEWORK}`);
  lines.push('');
  lines.push('REVIEW AREAS (verdicts already decided — write the narrative around them, do not re-grade):');
  for (const a of areas) {
    const g = groups[a.qId] || { answers: [], files: [] };
    lines.push('');
    lines.push(`[${a.qId}] ${a.title} (weight ${a.weight}${a.critical ? ', CRITICAL' : ''})`);
    lines.push(`  Decided: adequacy ${a.adequacy}, efficacy ${a.efficacy}, status ${a.status}`);
    lines.push(`  Prior one-line finding: ${clip(a.finding, nonce, 300)}`);

    const evidenceBits = [
      ...(g.answers || []).map(x => clip(x, nonce, EVIDENCE_SUMMARY_CAP)),
      ...(g.files || []).map(f => `file: ${clip(f.name, nonce, 80)}`)
    ];
    lines.push(`  Evidence summary: ${evidenceBits.length ? evidenceBits.join(' | ').slice(0, EVIDENCE_SUMMARY_CAP) : '(none)'}`);

    // Skip the grounding lookup entirely for areas with no evidence at all —
    // "nothing was provided" doesn't need a regulatory quote to explain, and
    // every token saved here matters on the free tier's 12k TPM cap.
    const hasEvidence = a.status !== 'missing';
    if (grounded && hasEvidence) {
      const hits = retrieveRegulatory(`${a.title}`, REFS_PER_AREA);
      if (hits.length) {
        const refText = hits.map(h => `[${h.source}] ${clip(h.text, nonce, GROUND_CHARS_PER_REF)}`).join('\n    ');
        lines.push(`  Regulatory reference available: \n    ${refText}`);
      } else {
        lines.push('  Regulatory reference available: (none retrieved — do not cite for this area)');
      }
    } else {
      lines.push('  Regulatory reference available: (none — do not cite for this area)');
    }
  }
  lines.push('');
  lines.push('Write the report JSON described in the system message.');
  return lines.join('\n');
}

// Assemble the model's structured pieces into the final formatted document —
// same "model judges/writes, code formats" split as scorer.js's draftReport.
function buildDocument(areas, modelOut, ctx) {
  const bySection = {};
  for (const a of areas) (bySection[a.section] = bySection[a.section] || []).push(a);
  const narrativeById = {};
  for (const n of (modelOut.areaNarratives || [])) {
    if (n && n.qId) narrativeById[n.qId] = n;
  }

  const L = [];
  L.push('INDEPENDENT AML/CTF PROGRAM EVALUATION REPORT');
  L.push(FRAMEWORK);
  L.push('');
  L.push(`Entity: ${ctx.entityLabel}`);
  L.push(`Evaluation date: ${new Date(ctx.scoredAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' })}`);
  L.push(`Overall score: ${ctx.finalScore}/100 (${ctx.rating})`);
  L.push(`Critical gaps identified: ${ctx.criticalFailures}`);
  L.push('');
  L.push('1. SCOPE & METHODOLOGY');
  L.push(
    `This report presents the findings of an independent evaluation of ${ctx.entityLabel}'s AML/CTF program, conducted ` +
    `under the Anti-Money Laundering and Counter-Terrorism Financing Amendment Act 2024 reforms. Consistent with the ` +
    `reform's Step 5 requirement, the evaluation covers the ENTIRE risk-based program — governance, risk assessment, ` +
    `policies and controls, and ongoing review — rather than a partial ("Part A only") review under the superseded ` +
    `s.161 framework. Money-laundering, terrorism-financing, and proliferation-financing risk were assessed together. ` +
    `Each of the ${areas.length} evidence areas below was assessed on two axes: adequacy (is the control documented) ` +
    `and efficacy (does the evidence demonstrate the control actually operates).`
  );
  L.push('');
  L.push('2. EXECUTIVE SUMMARY');
  L.push(String(modelOut.executiveSummary || '').trim() || '(not generated)');
  L.push('');
  L.push('3. DETAILED FINDINGS BY PROGRAM AREA');
  for (const [section, list] of Object.entries(bySection)) {
    L.push('');
    L.push(`${section.toUpperCase()}`);
    for (const a of list) {
      const n = narrativeById[a.qId];
      const flag = a.criticalFailure ? ' [CRITICAL GAP]' : '';
      L.push('');
      L.push(`${a.qId} — ${a.title} (${a.weightedMark}/${a.maxMark}, ${a.status})${flag}`);
      if (n?.narrative) {
        L.push(n.narrative);
      } else {
        L.push(a.finding || '(no finding recorded)');
      }
      if (n?.citation) L.push(`Regulatory basis: ${n.citation}`);
      if (a.recommendation) L.push(`Recommendation: ${a.recommendation}`);
    }
  }
  L.push('');
  L.push('4. OVERALL OPINION');
  L.push(String(modelOut.overallOpinion || '').trim() || '(not generated)');
  L.push('');
  L.push('5. RECOMMENDATIONS');
  const recs = Array.isArray(modelOut.recommendations) ? modelOut.recommendations.filter(Boolean) : [];
  if (recs.length) {
    recs.forEach((r, i) => L.push(`  ${i + 1}. ${r}`));
  } else {
    L.push('  (none generated)');
  }
  L.push('');
  L.push('6. EVIDENCE REVIEWED');
  for (const a of areas) {
    const g = ctx.groups[a.qId];
    const fileNames = (g?.files || []).map(f => f.originalName || f.name).filter(Boolean);
    L.push(`  ${a.qId}: ${fileNames.length ? fileNames.join(', ') : '(no documents provided)'}`);
  }
  L.push('');
  L.push('— Draft generated by the Centinl AI evaluator. This document requires review and sign-off by a qualified auditor before issue to the entity. —');
  return L.join('\n');
}

// areas: the ALREADY-SCORED result.areas array from scorer.js (never
// re-graded here). groups: the same evidence groups the score was computed
// from (used for the condensed per-area evidence summary + evidence list).
async function generateFullReport(areas, groups, entityLabel, scoredCtx) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const modelOut = await completeJson({
    system: SYSTEM_PROMPT,
    user: buildPrompt(areas, groups, entityLabel, nonce),
    temperature: 0.25,
    maxTokens: MAX_OUTPUT_TOKENS
  });

  const missing = areas.filter(a => !(modelOut.areaNarratives || []).some(n => n?.qId === a.qId)).map(a => a.qId);
  const fullText = buildDocument(areas, modelOut, { ...scoredCtx, entityLabel, groups });

  return {
    entity: entityLabel,
    framework: FRAMEWORK,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    grounded: isGrounded(),
    missingNarratives: missing,
    fullText
  };
}

module.exports = { generateFullReport };
