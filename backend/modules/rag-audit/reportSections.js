// =====================================================================
// REPORT STRUCTURE — the "4. Detailed Compliance Review" areas of the
// issued Independent External Review Report.
// ---------------------------------------------------------------------
// The portal collects evidence against 23 evidence areas (Q01–Q23, the
// question bank). The signed report the auditor actually issues is NOT
// organised by those questions — it walks the AML/CTF program the way a
// reviewer reads it: seventeen lettered areas (A–Q), each with a fixed
// "Requirement" paragraph (the obligation, in the auditor's house wording)
// followed by an "Auditor Observation" written for that entity.
//
// This file is the bridge: which questions feed which report area, and the
// requirement text that is printed verbatim. Requirement wording is code,
// not model output, on purpose — it is the one part of the report that must
// never drift or be invented per run. Only the observation is written by
// the model (fullReport.js), and only from the evidence + verdicts already
// decided by scorer.js.
//
//   questionIds — PRIMARY evidence areas: their answers, verdicts AND
//                 extracted document text are given to the model.
//   contextIds  — SECONDARY areas: verdict + answers only (no document
//                 text) so an area that informs two sections doesn't have
//                 its documents pasted into the prompt twice.
//   query       — retrieval query for the AUSTRAC knowledge base.
// =====================================================================

const REPORT_SECTIONS = [
  {
    key: 'enrolment',
    title: 'Enrolment, Registration and Regulatory Status',
    questionIds: ['Q10'],
    contextIds: ['Q20'],
    query: 'AUSTRAC enrolment registration remittance dealer register renewal designated services',
    requirement:
      'Reporting entities providing designated services must maintain current enrolment and registration with AUSTRAC and ensure all material changes to their business, ownership, key personnel, Reporting Group membership, designated services and operational structure are accurately maintained. Where the entity operates as a Remittance Network Provider or as the Lead Entity of a Reporting Group, it must also ensure that affiliates and Reporting Group members remain appropriately enrolled and registered and that all regulatory obligations associated with the Reporting Group are maintained.'
  },
  {
    key: 'program',
    title: 'Adoption and Maintenance of AML/CTF Compliance Program',
    questionIds: ['Q01'],
    contextIds: [],
    query: 'AML/CTF program adopt maintain governing body approval review update risk-based',
    requirement:
      'Reporting entities must adopt and maintain an AML/CTF Compliance Program that is appropriate to the nature, size and complexity of the business and capable of effectively identifying, mitigating and managing money laundering, terrorism financing and proliferation financing risks. The program should be approved by the Governing Body, periodically reviewed and updated to reflect legislative changes, operational developments and emerging financial crime risks.'
  },
  {
    key: 'governance',
    title: 'Governance and Senior Management Oversight',
    questionIds: ['Q11', 'Q02'],
    contextIds: ['Q01'],
    query: 'governing body senior management oversight AML/CTF program governance compliance culture reporting',
    requirement:
      'Senior management and the Governing Body must exercise effective oversight of the AML/CTF framework by ensuring that appropriate governance structures, resources, reporting mechanisms and risk management arrangements are established and maintained. Governance should promote a strong compliance culture and provide ongoing oversight of the effectiveness of AML/CTF controls.'
  },
  {
    key: 'amlco',
    title: 'Appointment of AML/CTF Compliance Officer',
    questionIds: ['Q08'],
    contextIds: ['Q04'],
    query: 'AML/CTF compliance officer appointment fit and proper management level authority independence',
    requirement:
      'Reporting entities must appoint an appropriately qualified AML/CTF Compliance Officer at management level who possesses sufficient authority, independence and resources to administer and oversee the AML/CTF framework and ensure ongoing compliance with legislative obligations. Under the reformed regime the appointment must satisfy the fit and proper requirement.'
  },
  {
    key: 'independentReview',
    title: 'Independent Review Function',
    questionIds: ['Q23', 'Q22'],
    contextIds: [],
    query: 'independent evaluation AML/CTF program independent reviewer frequency every three years findings remediation',
    requirement:
      'Reporting entities must ensure that their AML/CTF Compliance Program is independently evaluated at appropriate intervals by a suitably qualified and independent reviewer. The purpose of the review is to assess whether the AML/CTF framework remains appropriate to the nature, size and complexity of the business and whether controls are operating effectively in practice.'
  },
  {
    key: 'riskAssessment',
    title: 'Enterprise-Wide Risk Assessment',
    questionIds: ['Q07', 'Q05'],
    contextIds: [],
    query: 'ML/TF risk assessment customer product delivery channel jurisdiction proliferation financing residual risk',
    requirement:
      'Reporting entities must maintain a documented Enterprise-Wide Risk Assessment that identifies, assesses and manages money laundering, terrorism financing and proliferation financing risks across customers, products, services, delivery channels, jurisdictions, technology and operational activities. The assessment should underpin all AML/CTF controls and be reviewed whenever material changes occur.'
  },
  {
    key: 'employeeDD',
    title: 'Employee Due Diligence Program',
    questionIds: ['Q04', 'Q17'],
    contextIds: [],
    query: 'employee due diligence screening police check fit and proper personnel higher risk roles re-screening',
    requirement:
      'Reporting entities must implement an employee due diligence program designed to ensure that personnel performing AML/CTF-related functions are suitable, competent and trustworthy. Employee screening should include identity verification, criminal history assessments, conflict of interest management and ongoing suitability assessments for higher-risk roles.'
  },
  {
    key: 'training',
    title: 'AML/CTF Risk Awareness Training',
    questionIds: ['Q03'],
    contextIds: [],
    query: 'AML/CTF risk awareness training program employees obligations typologies refresher records',
    requirement:
      'Reporting entities must establish and maintain an AML/CTF Risk Awareness Training Program that ensures employees understand their AML/CTF obligations, emerging financial crime risks and their individual responsibilities in identifying and managing suspicious activity.'
  },
  {
    key: 'austracFeedback',
    title: 'Preparedness to Act on AUSTRAC Feedback',
    questionIds: ['Q09'],
    contextIds: ['Q01'],
    query: 'AUSTRAC feedback guidance regulatory change compliance report annual compliance report update program',
    requirement:
      'Reporting entities must maintain processes to receive, assess and implement AUSTRAC guidance, regulatory feedback, typology reports and legislative developments to ensure the AML/CTF Program remains current and effective.'
  },
  {
    key: 'reporting',
    title: 'Reporting Obligations',
    questionIds: ['Q16', 'Q18'],
    contextIds: ['Q09'],
    query: 'suspicious matter report threshold transaction report IFTI annual compliance report timely submission',
    requirement:
      'Reporting entities must maintain systems and controls capable of identifying reportable matters and ensuring the accurate and timely submission of Suspicious Matter Reports, Threshold Transaction Reports, International Funds Transfer Instruction reports, Annual Compliance Reports and other regulatory notifications.'
  },
  {
    key: 'transactionMonitoring',
    title: 'Transaction Monitoring Program',
    questionIds: ['Q06'],
    contextIds: ['Q16'],
    query: 'transaction monitoring program ongoing customer due diligence unusual transactions alerts investigation',
    requirement:
      'Reporting entities must maintain a risk-based transaction monitoring program capable of detecting unusual, complex or suspicious transactions, facilitating timely investigation and determining whether suspicious activity should be reported to AUSTRAC. Monitoring should be proportionate to the Entity\'s products, services, delivery channels and customer risk profile.'
  },
  {
    key: 'ecdd',
    title: 'Enhanced Customer Due Diligence',
    questionIds: ['Q15'],
    contextIds: ['Q05'],
    query: 'enhanced customer due diligence high risk customer PEP source of funds source of wealth senior management approval',
    requirement:
      'Reporting entities must apply Enhanced Customer Due Diligence where higher ML/TF/PF risks are identified, including high-risk customers, politically exposed persons, complex ownership structures, unusual transactions and customers connected with higher-risk jurisdictions.'
  },
  {
    key: 'recordKeeping',
    title: 'Record Keeping and Data Security',
    questionIds: ['Q14', 'Q21'],
    contextIds: [],
    query: 'record keeping seven years customer identification transaction records data security privacy',
    requirement:
      'Reporting entities must maintain customer identification records, transaction records, reporting records and AML/CTF documentation for the prescribed statutory period while ensuring appropriate security controls protect customer information from unauthorised access, loss or misuse.'
  },
  {
    key: 'customerId',
    title: 'Customer Identification Process',
    questionIds: ['Q19'],
    contextIds: ['Q13'],
    query: 'customer identification procedures initial customer due diligence verify identity before designated service customer risk rating',
    requirement:
      'Reporting entities must establish risk-based customer identification procedures capable of verifying customer identity before providing designated services and maintaining sufficient customer information to support ongoing customer due diligence and transaction monitoring.'
  },
  {
    key: 'sanctions',
    title: 'Sanctions and PEP Screening',
    questionIds: ['Q13'],
    contextIds: ['Q19'],
    query: 'sanctions screening politically exposed person screening onboarding ongoing targeted financial sanctions',
    requirement:
      'Reporting entities must implement appropriate sanctions and politically exposed person screening processes during customer onboarding and throughout the business relationship to identify customers presenting elevated financial crime or sanctions risks.'
  },
  {
    key: 'beneficialOwnership',
    title: 'Ultimate Beneficial Ownership',
    questionIds: ['Q19'],
    contextIds: ['Q01', 'Q13'],
    query: 'beneficial owner identification verification control structure non-individual customer reasonable measures',
    requirement:
      'Reporting entities must take reasonable measures to identify, understand and verify the beneficial ownership and control structure of non-individual customers and other relevant business relationships as part of customer due diligence.'
  },
  {
    key: 'groupOversight',
    title: 'Reporting Group, Branch and Affiliate Oversight Framework',
    questionIds: ['Q20', 'Q12'],
    contextIds: ['Q11'],
    query: 'reporting group lead entity affiliates agents branches oversight outsourcing retained accountability',
    requirement:
      'Where the entity operates branches, engages agents or affiliates, outsources AML/CTF functions or acts within a Reporting Group, it is required to establish and maintain an effective oversight framework capable of ensuring that Reporting Group members, branches, affiliates and outsourced providers consistently comply with the AML/CTF Program. This includes governance arrangements, operational supervision, compliance reporting, quality assurance, remediation processes and ongoing monitoring sufficient to demonstrate that AML/CTF controls operate effectively across the whole network.'
  }
];

// The "3.3 Areas Reviewed" bullet list printed in the Scope section — the
// reviewer's summary of what the seventeen areas above cover.
const AREAS_REVIEWED = [
  'Enrolment, registration and regulatory compliance.',
  'Governance and senior management oversight.',
  'AML/CTF Compliance Officer responsibilities.',
  'Enterprise-Wide Risk Assessment.',
  'Employee due diligence.',
  'AML/CTF training.',
  'Response to AUSTRAC guidance.',
  'Regulatory reporting obligations.',
  'Transaction monitoring.',
  'Enhanced Customer Due Diligence.',
  'Record keeping and data protection.',
  'Customer identification procedures.',
  'Sanctions and PEP screening.',
  'Beneficial ownership procedures.',
  'Branch, affiliate and Reporting Group oversight.',
  'Operational effectiveness of onboarding, transaction monitoring, investigation and reporting capabilities.'
];

// The "2. Business Profile" table rows, in the order they are printed. The
// model fills these from the entity's documents (fullReport.js); anything it
// cannot evidence is printed as NOT_EVIDENCED rather than guessed.
const PROFILE_FIELDS = [
  { key: 'legalName', label: 'Legal Name' },
  { key: 'tradingName', label: 'Trading Name' },
  { key: 'abn', label: 'ABN' },
  { key: 'acn', label: 'ACN' },
  { key: 'registeredOffice', label: 'Registered Office' },
  { key: 'principalPlaceOfBusiness', label: 'Principal Place of Business' },
  { key: 'dateOfIncorporation', label: 'Date of Incorporation' },
  { key: 'entityStatus', label: 'Entity Status' },
  { key: 'directorAndUbo', label: 'Director and Ultimate Beneficial Owner' },
  { key: 'businessActivities', label: 'Business Activities' },
  { key: 'leadReportingEntity', label: 'Lead Reporting Entity' },
  { key: 'reportingGroupMember', label: 'Reporting Group Member' },
  { key: 'complianceOfficer', label: 'Current AML/CTF Compliance Officer' },
  { key: 'complianceOfficerQualifications', label: 'Compliance Officer Qualifications' },
  { key: 'numberOfEmployees', label: 'Number of Employees' },
  { key: 'branches', label: 'Branches' },
  { key: 'registeredAffiliates', label: 'Registered Affiliates' },
  { key: 'countriesServiced', label: 'Countries Serviced' },
  { key: 'regulatoryProfile', label: 'Regulatory Profile' },
  { key: 'deliveryChannels', label: 'Delivery Channels' },
  { key: 'identityVerificationPlatform', label: 'Identity Verification Platform' },
  { key: 'transactionMonitoring', label: 'Transaction Monitoring' },
  { key: 'austracRegistration', label: 'AUSTRAC Registration' }
];

const NOT_EVIDENCED = 'Not evidenced in the documentation provided for review.';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function letterFor(i) {
  // A..Z, then AA, AB… — a custom question bank can exceed 26 areas.
  return i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26];
}

// Resolve the sections to print for THIS review. `activeQuestions` is the
// (possibly per-client filtered) question list scoring used. A built-in
// section is included only when at least one of its primary questions was
// actually asked; any active question no section claims (admin-added
// custom questions) becomes its own lettered area so nothing that was
// scored is silently left out of the issued report.
function resolveSections(activeQuestions) {
  const activeIds = new Set(activeQuestions.map(q => q.id));
  const byId = new Map(activeQuestions.map(q => [q.id, q]));
  const claimed = new Set();
  const out = [];

  for (const s of REPORT_SECTIONS) {
    const primary = s.questionIds.filter(id => activeIds.has(id));
    if (!primary.length) continue;
    primary.forEach(id => claimed.add(id));
    out.push({
      key: s.key, title: s.title, requirement: s.requirement, query: s.query,
      questionIds: primary,
      contextIds: s.contextIds.filter(id => activeIds.has(id)),
      builtin: true
    });
  }
  for (const q of activeQuestions) {
    if (claimed.has(q.id)) continue;
    // Secondary-only coverage still counts as reviewed, but a question no
    // built-in section takes as primary evidence gets its own area.
    out.push({
      key: `custom:${q.id}`, title: q.title,
      requirement: [q.adequacy, q.efficacy].filter(Boolean).join(' '),
      query: q.title, questionIds: [q.id], contextIds: [], builtin: false
    });
  }
  return out.map((s, i) => ({ ...s, letter: letterFor(i), titles: s.questionIds.map(id => byId.get(id)?.title).filter(Boolean) }));
}

module.exports = { REPORT_SECTIONS, AREAS_REVIEWED, PROFILE_FIELDS, NOT_EVIDENCED, resolveSections, letterFor };
