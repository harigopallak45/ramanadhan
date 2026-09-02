// =====================================================================
// SCORING RUBRIC — AUSTRAC AML/CTF Independent EVALUATION (2026 Reform)
// ---------------------------------------------------------------------
// Aligned to the Anti-Money Laundering and Counter-Terrorism Financing
// Amendment Act 2024 reforms — the new AML/CTF program obligations that
// commenced 31 March 2026 for existing reporting entities (Tranche 2 /
// newly regulated entities from 1 July 2026).
//
// WHAT CHANGED FROM THE OLD FRAMEWORK (and is reflected below):
//   • The old "independent review of Part A" (s.161 biennial review) is
//     replaced by an "independent EVALUATION of the ENTIRE program"
//     (program Step 5), at least once every 3 years.
//   • The mandatory Part A / Part B split is GONE. The program is one
//     risk-based, OUTCOMES-oriented framework (program Steps 1–4:
//     governance → risk assessment → AML/CTF policies → review/update).
//   • Customer due diligence splits into INITIAL CDD and ONGOING CDD,
//     with simplified CDD (low risk) and enhanced CDD (high risk).
//   • Proliferation financing (PF) sits alongside ML/TF throughout.
//   • Appointing a FIT AND PROPER AML/CTF compliance officer is now an
//     explicit statutory requirement.
//   • The Annual Compliance Report moves to FINANCIAL-YEAR cycles
//     (next period 1 Jul 2026 – 30 Jun 2027).
//
// This rubric is the single source of truth the AI scorer uses to grade
// each entity's evidence. The 23 evidence areas (Q01–Q23) are KEPT (they
// map to the GHL custom fields and the document-collection workflow); the
// CRITERIA, sections, weights and criticality are re-tuned to the reform.
//
// Each area is double-scored by the AI:
//   • adequacy — is the control documented / does the evidence exist?
//   • efficacy — does the evidence prove the control actually OPERATES
//                and reduces ML/TF/PF harm?
//
// Weights sum to 100 and are tuned to reform materiality (risk
// assessment, CDD, transaction monitoring/ongoing CDD, SMR reporting and
// the whole-program evaluation carry the most marks). The auditor
// (Pivot2Thrive) should review and tune the weights, criteria and bands —
// nothing here is locked.
// =====================================================================

// Human label for the framework this rubric scores against. Surfaced by
// the scorer + UI so it's unambiguous which legal regime applied.
const FRAMEWORK = 'AUSTRAC AML/CTF Reform (Amendment Act 2024) — independent evaluation, effective 31 Mar 2026';

// Blend used when collapsing adequacy + efficacy into one mark per area.
// Efficacy is weighted heavier: a documented-but-inoperative control is
// worth less than one proven to work.
const ADEQUACY_BLEND = 0.4;
const EFFICACY_BLEND = 0.6;

// Penalty (in final marks, out of 100) applied for each CRITICAL area the
// AI flags as inadequate/missing. Surfaces the negative deductions for the
// systemic shortcomings an independent evaluation must call out.
const CRITICAL_DEDUCTION = 3;

// A critical area counts as a "failure" (and triggers the deduction) when its
// blended adequacy/efficacy mark falls below this — derived from the NUMBERS,
// not the model's free-text status, so an inflated label can't hide a gap.
const CRITICAL_BLEND_THRESHOLD = 40;

// The only status strings we accept from the model; anything else is coerced.
const ALLOWED_STATUSES = ['adequate', 'partial', 'inadequate', 'missing'];

// Rating bands applied to the final 0–100 score (after deductions).
const RATING_BANDS = [
  { min: 85, label: 'Compliant — Strong', tone: 'pass' },
  { min: 70, label: 'Adequate — Minor Gaps', tone: 'watch' },
  { min: 50, label: 'Deficient — Remediation Required', tone: 'fail' },
  { min: 0,  label: 'Critical — Non-Compliant', tone: 'critical' }
];

// The 23 evidence areas. `critical: true` marks areas where a gap is a
// systemic AML/CTF/PF failure (these drive the negative deductions).
//
// Section labels follow the reform program structure:
//   Step 1 Governance · Step 2 Risk assessment · Step 3 AML/CTF policies ·
//   Step 4 Review & update · Step 5 Independent evaluation ·
//   Customer due diligence (Initial / Ongoing / Enhanced) ·
//   Personnel due diligence & training · Reporting to AUSTRAC ·
//   Record keeping · Outsourcing & reporting groups.
const RUBRIC = [
  {
    id: 'Q01', section: 'Steps 1–4: AML/CTF Program', title: 'AML/CTF program — policies, procedures & framework',
    weight: 9, critical: true,
    adequacy: 'A current AML/CTF program approved by the governing body exists as a single risk-based framework (no Part A/Part B split required) covering all designated services, with documented policies that manage the ML/TF/PF risks identified in the risk assessment.',
    efficacy: 'Version history, approval dates and review cadence show the program is OUTCOMES-oriented and actually used — policies trace to assessed risks, are operationalised, and are reviewed/updated (Step 4), not a static template.'
  },
  {
    id: 'Q02', section: 'Step 1: Governance', title: 'AML/CTF resourcing & compliance capacity',
    weight: 2, critical: false,
    adequacy: 'Compliance staffing/resourcing is documented with roles and reporting lines into senior management and the governing body.',
    efficacy: 'Resourcing is proportionate to transaction volume, ML/TF/PF risk and designated services; no single point of failure.'
  },
  {
    id: 'Q03', section: 'Personnel DD & Training', title: 'AML/CTF training — schedule, materials & records',
    weight: 5, critical: false,
    adequacy: 'A documented AML/CTF training program (schedule, materials, agenda) exists for personnel whose roles require it.',
    efficacy: 'Attendance/completion records and content recency prove staff are actually trained on current reform obligations, the entity\'s policies and ML/TF/PF typologies.'
  },
  {
    id: 'Q04', section: 'Personnel DD & Training', title: 'Personnel due diligence — pre-employment screening',
    weight: 3, critical: false,
    adequacy: 'Personnel due-diligence screening (e.g. National Police Clearance / background checks) is on file for personnel in AML/CTF-relevant roles.',
    efficacy: 'Screening is current, risk-based to the role, and supported by a documented renewal/re-screening cadence.'
  },
  {
    id: 'Q05', section: 'Step 2: Risk Assessment', title: 'Delivery channels & jurisdiction risk',
    weight: 3, critical: false,
    adequacy: 'Delivery channels and the countries/jurisdictions relevant to the services are documented as risk-assessment inputs.',
    efficacy: 'High-risk / sanctioned jurisdictions are identified and risk-rated, demonstrably feeding the ML/TF/PF risk assessment, customer risk ratings and enhanced CDD.'
  },
  {
    id: 'Q06', section: 'Ongoing CDD: Monitoring', title: 'Transaction monitoring — sample month',
    weight: 8, critical: true,
    adequacy: 'A complete transaction list for the sample month is provided, with documented monitoring rules/thresholds.',
    efficacy: 'Ongoing CDD monitoring genuinely operates over the population — rules/thresholds detect unusual transactions/behaviour, alerts are triaged, and responses are recorded.'
  },
  {
    id: 'Q07', section: 'Step 2: Risk Assessment', title: 'ML/TF/PF risk assessment & AUSTRAC business profile',
    weight: 9, critical: true,
    adequacy: 'A documented enterprise risk assessment identifying and assessing money-laundering, terrorism-financing AND proliferation-financing risks (across customers, services, channels, jurisdictions) exists, consistent with the AUSTRAC business profile.',
    efficacy: 'Risk ratings are justified by the business model, kept current, and demonstrably DRIVE the AML/CTF policies, customer risk ratings and CDD measures (the foundation of the reform program).'
  },
  {
    id: 'Q08', section: 'Step 1: Governance', title: 'Fit & proper AML/CTF compliance officer',
    weight: 4, critical: true,
    adequacy: 'A nominated AML/CTF compliance officer is documented with a resume/profile evidencing the now-mandatory "fit and proper" appointment.',
    efficacy: 'The compliance officer has appropriate seniority, independence, competence and authority to implement the AML/CTF program and report to the governing body/senior management.'
  },
  {
    id: 'Q09', section: 'Reporting to AUSTRAC', title: 'AUSTRAC compliance report (financial-year cycle)',
    weight: 4, critical: false,
    adequacy: 'The most recent AUSTRAC compliance report was lodged and a copy is provided (reporting now aligns to financial-year cycles, next period 1 Jul 2026 – 30 Jun 2027).',
    efficacy: 'Report content is consistent with the program and risk assessment, and any prior findings/issues were actioned.'
  },
  {
    id: 'Q10', section: 'Enrolment & Registration', title: 'AUSTRAC enrolment & registration currency',
    weight: 3, critical: true,
    adequacy: 'Current AUSTRAC enrolment/registration evidence is provided, with the updated details required under the new Rules.',
    efficacy: 'Enrolment/registration is active and current, and details match the designated services actually offered (incl. any newly regulated services).'
  },
  {
    id: 'Q11', section: 'Step 1: Governance', title: 'Governance framework & accountability (org chart)',
    weight: 2, critical: false,
    adequacy: 'An org chart / governance map shows the governing body, senior manager and AML/CTF compliance officer roles and reporting lines.',
    efficacy: 'Lines of accountability reach the governing body/senior management with the explicit oversight of ML/TF/PF risk the reform requires.'
  },
  {
    id: 'Q12', section: 'Outsourcing', title: 'Outsourced AML/CTF functions',
    weight: 3, critical: false,
    adequacy: 'Outsourced AML/CTF functions and the governing agreements are documented.',
    efficacy: 'Oversight, SLAs and the entity\'s RETAINED accountability for the outsourced obligations are evidenced (outsourcing does not transfer the obligation).'
  },
  {
    id: 'Q13', section: 'Initial CDD: Screening', title: 'IDV / sanctions / PEP screening tooling',
    weight: 6, critical: true,
    adequacy: 'Evidence of identity-verification, targeted-financial-sanctions and PEP screening tooling (e.g. provider invoices/config) is provided.',
    efficacy: 'Screening for sanctions and PEP status is applied to customers, representatives, persons-acted-for and beneficial owners at initial CDD and on an ongoing basis, with coverage and hit-handling evidenced.'
  },
  {
    id: 'Q14', section: 'Record Keeping & Security', title: 'Information security & data protection',
    weight: 2, critical: false,
    adequacy: 'Information-security, record-keeping and data-protection controls are documented.',
    efficacy: 'Controls (access, encryption, retention, incident response) are tested and operating, supporting the reform record-keeping obligations.'
  },
  {
    id: 'Q15', section: 'Enhanced CDD', title: 'Enhanced customer due diligence — sample month',
    weight: 6, critical: true,
    adequacy: 'Enhanced CDD case files for the sample month are provided.',
    efficacy: 'Enhanced CDD is triggered where required (high ML/TF/PF risk, foreign PEP, or an SMR obligation arises), investigations are substantive, and outcomes are recorded.'
  },
  {
    id: 'Q16', section: 'Reporting to AUSTRAC', title: 'Suspicious matter reports — sample month',
    weight: 8, critical: true,
    adequacy: 'SMR records (or a justified nil return) for the sample month are provided.',
    efficacy: 'Decision-to-report is timely (within statutory deadlines) and well-reasoned; the SMR pipeline links to monitoring/enhanced CDD and captures the expanded reportable details.'
  },
  {
    id: 'Q17', section: 'Personnel DD & Training', title: 'Employee files & ongoing personnel due diligence',
    weight: 3, critical: false,
    adequacy: 'Employee due-diligence files and a periodic re-screening process for AML/CTF-relevant roles exist.',
    efficacy: 'Re-screening actually occurs on a risk-based cadence and covers personnel in roles that require due diligence.'
  },
  {
    id: 'Q18', section: 'Reporting to AUSTRAC', title: 'Threshold transactions & cash-intensity controls',
    weight: 3, critical: false,
    adequacy: 'Cash-handling exposure and threshold-transaction (TTR) controls are documented.',
    efficacy: 'Threshold transaction reporting, cash thresholds and cash-specific monitoring are operating (note reduced gambling CDD threshold $10k→$5k where relevant).'
  },
  {
    id: 'Q19', section: 'Initial CDD', title: 'Initial customer due diligence — sample month',
    weight: 8, critical: true,
    adequacy: 'Initial-CDD/onboarding records for the sample month are provided.',
    efficacy: 'Before providing a designated service, the customer (and representatives, persons-acted-for and beneficial owners) is identified and verified to program standard, ML/TF risk is established, and a customer risk rating is assigned (with simplified/enhanced CDD applied by risk).'
  },
  {
    id: 'Q20', section: 'Outsourcing & Groups', title: 'Agents, distributors & reporting groups',
    weight: 2, critical: false,
    adequacy: 'Distribution/agent relationships and any reporting-group arrangements (which replaced designated business groups on 31 Mar 2026) and their review cadence are documented.',
    efficacy: 'Reviews occur and feed channel risk-rating and controls; reporting-group roles/obligations (lead entity vs members) are clear where applicable.'
  },
  {
    id: 'Q21', section: 'Record Keeping & Security', title: 'Privacy (Australian Privacy Principles)',
    weight: 1, critical: false,
    adequacy: 'A documented APP/privacy position exists.',
    efficacy: 'Privacy controls reconcile with AML/CTF record-keeping and the handling of CDD/KYC data.'
  },
  {
    id: 'Q22', section: 'Step 5: Independent Evaluation', title: 'Evaluation scope & on-site arrangements',
    weight: 1, critical: false,
    adequacy: 'The scope and arrangements for the independent evaluation (incl. any on-site inspection) are documented.',
    efficacy: 'Scope is risk-appropriate and covers the WHOLE program; findings are tracked to closure.'
  },
  {
    id: 'Q23', section: 'Step 5: Independent Evaluation', title: 'Independent evaluation of the entire program',
    weight: 5, critical: true,
    adequacy: 'Evidence of an independent evaluation of the ENTIRE AML/CTF program (not just Part A) exists or is scheduled at an appropriate frequency (at least every 3 years).',
    efficacy: 'The evaluation is performed by someone sufficiently independent (not the AML/CTF compliance officer or compliance team), and evaluates the risk assessment, the design of the policies, and whether the entity appropriately identified, assessed, mitigated and managed ML/TF/PF risk and complied with its policies; findings are rated and remediated.'
  }
];

function ratingForScore(score) {
  return (RATING_BANDS.find(b => score >= b.min) || RATING_BANDS[RATING_BANDS.length - 1]).label;
}

function toneForScore(score) {
  return (RATING_BANDS.find(b => score >= b.min) || RATING_BANDS[RATING_BANDS.length - 1]).tone;
}

// Sanity check: weights must total 100. Logged once at module load.
const WEIGHT_TOTAL = RUBRIC.reduce((s, r) => s + r.weight, 0);
if (WEIGHT_TOTAL !== 100) {
  console.warn(`[rag-audit] Rubric weights total ${WEIGHT_TOTAL}, expected 100. Scores will be normalised.`);
}

module.exports = {
  FRAMEWORK,
  RUBRIC,
  WEIGHT_TOTAL,
  ADEQUACY_BLEND,
  EFFICACY_BLEND,
  CRITICAL_DEDUCTION,
  CRITICAL_BLEND_THRESHOLD,
  ALLOWED_STATUSES,
  RATING_BANDS,
  ratingForScore,
  toneForScore
};
