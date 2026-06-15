// =====================================================================
// CHAPTER 6 SCORING RUBRIC — AUSTRAC AML/CTF s.161 Independent Review
// ---------------------------------------------------------------------
// This is a DRAFT, AUSTRAC-aligned rubric. It is the single source of
// truth the AI scorer uses to grade each entity's survey responses.
//
// Each of the 23 review areas (Q01–Q23) carries a WEIGHT. Weights are
// tuned to AML/CTF materiality (program, transaction monitoring, SMR
// reporting and KYC carry the most marks) and SUM TO 100.
//
// Every area is double-scored by the AI:
//   • adequacy — is the control documented / does the evidence exist?
//   • efficacy — does the evidence prove the control actually OPERATES
//                and reduces ML/TF harm?
//
// The auditor (Pivot2Thrive) should review and tune the weights, the
// criteria text, and the rating bands below — nothing here is locked.
// =====================================================================

// Blend used when collapsing adequacy + efficacy into one mark per area.
// Efficacy is weighted heavier: a documented-but-inoperative control is
// worth less than one proven to work.
const ADEQUACY_BLEND = 0.4;
const EFFICACY_BLEND = 0.6;

// Penalty (in final marks, out of 100) applied for each CRITICAL area the
// AI flags as inadequate/missing. Surfaces the "negative deductions for
// critical shortcomings" the Chapter 6 framework calls for.
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

// The 23 review areas. `critical: true` marks areas where a gap is a
// systemic AML/CTF failure (these drive the negative deductions).
const RUBRIC = [
  {
    id: 'Q01', section: 'A. Governance & Program', title: 'AML/CTF Program, policies, procedures',
    weight: 9, critical: true,
    adequacy: 'A current, board-approved Part A (risk-based systems & controls) and Part B (customer identification) program exists, covering all designated services.',
    efficacy: 'Version history, approval dates and review cadence show the program is maintained and actually used — not a static template.'
  },
  {
    id: 'Q02', section: 'A. Governance & Program', title: 'Fraud / Financial Crime Compliance headcount',
    weight: 3, critical: false,
    adequacy: 'Compliance/FCC staffing is documented with roles and reporting lines.',
    efficacy: 'Headcount is proportionate to transaction volume and risk; no single point of failure.'
  },
  {
    id: 'Q03', section: 'C. Training', title: 'Training schedule, materials and agenda',
    weight: 5, critical: false,
    adequacy: 'A documented AML/CTF training program with schedule, materials and agenda exists.',
    efficacy: 'Attendance/completion records and content recency prove staff are actually trained on current obligations and typologies.'
  },
  {
    id: 'Q04', section: 'B. Personnel Due Diligence', title: 'National Police Clearance Certificates',
    weight: 3, critical: false,
    adequacy: 'NPCCs (or equivalent screening) are on file for relevant personnel.',
    efficacy: 'Certificates are current and cover the people in AML-sensitive roles, with a renewal cadence.'
  },
  {
    id: 'Q05', section: 'D. Jurisdiction / Delivery', title: 'Delivery channel jurisdictions',
    weight: 3, critical: false,
    adequacy: 'Delivery channels and the jurisdictions served are documented.',
    efficacy: 'High-risk / sanctioned jurisdictions are identified and risk-rated, feeding the program and EDD.'
  },
  {
    id: 'Q06', section: 'E. Transaction Monitoring', title: 'Full transaction list — sample month',
    weight: 8, critical: true,
    adequacy: 'A complete transaction list for the sample month is provided.',
    efficacy: 'Monitoring rules/thresholds are evidenced and alerts are triaged — data shows monitoring genuinely operates over the population.'
  },
  {
    id: 'Q07', section: 'A. Governance & Program', title: 'AUSTRAC Business Profile / ML-TF risk assessment',
    weight: 7, critical: true,
    adequacy: 'A documented enterprise ML/TF risk assessment / AUSTRAC business profile exists.',
    efficacy: 'Risk ratings are justified by the business model and reviewed; they demonstrably drive controls.'
  },
  {
    id: 'Q08', section: 'B. Personnel Due Diligence', title: 'AMLCO resume / profile',
    weight: 3, critical: false,
    adequacy: 'A nominated AML Compliance Officer is documented with a resume/profile.',
    efficacy: 'The AMLCO has appropriate seniority, independence and competence for the role.'
  },
  {
    id: 'Q09', section: 'G. Reporting', title: 'Prior year Annual Compliance Report',
    weight: 4, critical: false,
    adequacy: 'The prior-year ACR was lodged and a copy is provided.',
    efficacy: 'ACR content is consistent with the program and any prior findings were actioned.'
  },
  {
    id: 'Q10', section: 'A. Governance & Program', title: 'AUSTRAC registration & renewals',
    weight: 3, critical: true,
    adequacy: 'Current AUSTRAC enrolment/registration evidence is provided.',
    efficacy: 'Registration is active, renewals are current, and details match the designated services offered.'
  },
  {
    id: 'Q11', section: 'A. Governance & Program', title: 'AML Compliance framework org chart',
    weight: 2, critical: false,
    adequacy: 'An org chart showing the compliance framework and reporting lines exists.',
    efficacy: 'Lines of accountability reach the board/senior management with clear independence.'
  },
  {
    id: 'Q12', section: 'H. Outsourcing', title: 'Outsourced compliance functions',
    weight: 3, critical: false,
    adequacy: 'Outsourced AML/CTF functions and the governing agreements are documented.',
    efficacy: 'Oversight, SLAs and the entity\'s retained accountability are evidenced.'
  },
  {
    id: 'Q13', section: 'F. KYC / Identity', title: 'Data service invoice — IDV / Sanctions / PEP',
    weight: 6, critical: true,
    adequacy: 'Evidence of IDV, sanctions and PEP screening tooling (e.g. provider invoices) is provided.',
    efficacy: 'Screening is applied at onboarding and ongoing, with coverage and hit-handling evidenced.'
  },
  {
    id: 'Q14', section: 'I. Information Security', title: 'Cyber attack prevention & data protection',
    weight: 4, critical: false,
    adequacy: 'Information-security and data-protection controls are documented.',
    efficacy: 'Controls (access, encryption, incident response) are tested and operating.'
  },
  {
    id: 'Q15', section: 'E. Transaction Monitoring', title: 'EDD investigations — sample month',
    weight: 6, critical: true,
    adequacy: 'Enhanced Due Diligence case files for the sample month are provided.',
    efficacy: 'EDD is triggered by risk, investigations are substantive and outcomes are recorded.'
  },
  {
    id: 'Q16', section: 'G. Reporting', title: 'Suspicious Matter Reports — sample month',
    weight: 8, critical: true,
    adequacy: 'SMR records (or a justified nil return) for the sample month are provided.',
    efficacy: 'Decision-to-report is timely and well-reasoned; SMR pipeline links to monitoring/EDD.'
  },
  {
    id: 'Q17', section: 'B. Personnel Due Diligence', title: 'Employee files & periodic due diligence',
    weight: 3, critical: false,
    adequacy: 'Employee due-diligence files and a periodic re-screening process exist.',
    efficacy: 'Re-screening actually occurs on cadence and covers risk-relevant roles.'
  },
  {
    id: 'Q18', section: 'J. Cash Intensity', title: 'Cash intensity management',
    weight: 3, critical: false,
    adequacy: 'Cash-handling exposure and controls are documented.',
    efficacy: 'Thresholds, TTR obligations and cash-specific monitoring are operating.'
  },
  {
    id: 'Q19', section: 'F. KYC / Identity', title: 'Customer onboarding — sample month',
    weight: 7, critical: true,
    adequacy: 'Onboarding/KYC records for the sample month are provided.',
    efficacy: 'Identity is collected and verified to program standard before service; risk-rating is applied.'
  },
  {
    id: 'Q20', section: 'H. Outsourcing', title: 'Distribution relationship review cadence',
    weight: 2, critical: false,
    adequacy: 'Distribution/agent relationships and a review cadence are documented.',
    efficacy: 'Reviews occur and feed channel risk-rating and controls.'
  },
  {
    id: 'Q21', section: 'K. Privacy', title: 'Australian Privacy Principles response',
    weight: 2, critical: false,
    adequacy: 'A documented APP/privacy position exists.',
    efficacy: 'Privacy controls reconcile with AML record-keeping and data handling.'
  },
  {
    id: 'Q22', section: 'L. On-site Inspection', title: 'On-site inspection scope',
    weight: 2, critical: false,
    adequacy: 'On-site inspection scope/arrangements are documented.',
    efficacy: 'Scope is risk-appropriate and findings are tracked to closure.'
  },
  {
    id: 'Q23', section: 'M. Internal Testing', title: 'Internal reviews and systemic tests',
    weight: 4, critical: true,
    adequacy: 'Independent/internal testing of the AML/CTF program is documented.',
    efficacy: 'Tests are genuinely independent, findings are rated and remediation is tracked.'
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
