// Fictional fixtures for the e2e suite. Nothing here is a real client —
// the entity, people, numbers and narrative are invented. The report and
// scorecard SHAPES come from the backend's own modules so the fixtures
// can't drift from what the app actually renders.
const path = require('path');
const { REPORT_SECTIONS, PROFILE_FIELDS, AREAS_REVIEWED, NOT_EVIDENCED } = require(path.join(__dirname, '..', '..', '..', 'backend', 'modules', 'rag-audit', 'reportSections.js'));
const { RUBRIC } = require(path.join(__dirname, '..', '..', '..', 'backend', 'modules', 'rag-audit', 'rubric.js'));

const CONTACT_ID = 'CONTACTe2e0000000001';
const ADMIN_ID = 'ADMINe2e00000000001';

const adminAccount = { id: ADMIN_ID, firstName: 'Priya', lastName: 'Auditor', name: 'Priya Auditor', email: 'priya@example-audit.test', phone: '', companyName: 'Example Audit Firm', isAdmin: true };

const users = [
  { id: CONTACT_ID, name: 'Sam Client', email: 'sam@example-remit.test', company: 'Example Remit Pty Ltd', tags: ['audit user', 'audit submitted'], dateAdded: '2026-08-01T00:00:00.000Z', status: 'Completed', role: 'client' },
  { id: 'CONTACTe2e0000000002', name: 'Lee Newbie', email: 'lee@example-fx.test', company: 'Example FX Pty Ltd', tags: ['audit user'], dateAdded: '2026-08-10T00:00:00.000Z', status: 'In Progress', role: 'client' },
  { id: ADMIN_ID, name: 'Priya Auditor', email: 'priya@example-audit.test', company: 'Example Audit Firm', tags: ['audit admin', 'audit user'], dateAdded: '2026-07-01T00:00:00.000Z', status: 'Admin', role: 'admin' }
];

const contact = {
  id: CONTACT_ID, firstName: 'Sam', lastName: 'Client', email: 'sam@example-remit.test',
  companyName: 'Example Remit Pty Ltd', tags: ['audit user', 'audit submitted']
};

// The question bank as the form-schema endpoint returns it (no GHL ids).
const questions = RUBRIC.map((q) => ({
  id: q.id, section: q.section, title: q.title, weight: 1, critical: q.critical, lookingFor: q.adequacy,
  fields: q.id === 'Q01'
    ? [{ key: 'program_notes', label: 'Program notes / summary', inputType: 'textarea', options: null }, { key: 'program_files', label: 'Supporting documents', inputType: 'file', options: null }]
    : q.id === 'Q08'
      ? [{ key: 'amlco_name', label: 'AMLCO name', inputType: 'text', options: null }, { key: 'amlco_cv', label: 'AMLCO CV', inputType: 'file', options: null }]
      : [{ key: 'value', label: 'Answer', inputType: 'textarea', options: null }]
}));

const answers = {
  Q01: { program_notes: { value: 'Program v3.1 approved June 2026', files: [] }, program_files: { value: '', files: [{ name: 'Example_AMLCTF_Program_v3.pdf', url: 'https://files.example.test/program.pdf' }] } },
  Q08: { amlco_name: { value: 'Jordan Officer', files: [] }, amlco_cv: { value: '', files: [] } },
  Q06: { value: { value: '1,240 transactions in July', files: [] } }
};

const reportDefaults = { auditorName: 'Priya Auditor', auditorCredentials: 'CAMS', firmName: 'Example Audit Firm', brandName: 'Centinl' };

function makeScoreResult({ score = 68, scoredAt = '2026-09-10T01:00:00.000Z' } = {}) {
  const areas = RUBRIC.map((q, i) => {
    const adequacy = 30 + ((i * 7) % 60);
    const efficacy = 20 + ((i * 11) % 60);
    const blended = 0.4 * adequacy + 0.6 * efficacy;
    const status = blended >= 70 ? 'adequate' : blended >= 40 ? 'partial' : 'inadequate';
    const criticalFailure = q.critical && blended < 40;
    return {
      qId: q.id, section: q.section, title: q.title, weight: 1, adequacy, efficacy,
      weightedMark: Math.round(blended) / 100, maxMark: 1, status, critical: q.critical, criticalFailure,
      filesCount: answers[q.id] ? 1 : 0, hasAnswer: !!answers[q.id],
      finding: `Fixture finding for ${q.id}: evidence ${status}.`,
      recommendation: `Fixture recommendation for ${q.id}.`
    };
  });
  const criticalFailures = areas.filter((a) => a.criticalFailure).length;
  const assessment = score >= 85 ? 'Effective with Minor Enhancement Opportunities' : score >= 70 ? 'Effective with Moderate Enhancement Opportunities' : score >= 50 ? 'Partially Effective — Remediation Required' : 'Not Effective — Significant Remediation Required';
  const rating = score >= 85 ? 'Compliant — Strong' : score >= 70 ? 'Adequate — Minor Gaps' : score >= 50 ? 'Deficient — Remediation Required' : 'Critical — Non-Compliant';
  return {
    entity: 'Sam Client (Example Remit Pty Ltd)', framework: 'AUSTRAC AML/CTF Reform (Amendment Act 2024)', model: 'fixture-model',
    scoredAt, score, rawScore: score + 6, deduction: 6, criticalFailures, rating,
    tone: score >= 85 ? 'pass' : score >= 70 ? 'watch' : score >= 50 ? 'fail' : 'critical', assessment,
    executiveSummary: 'Fixture executive summary: the framework is documented but operation is only partly evidenced.',
    topRisks: ['Transaction monitoring rules not evidenced', 'No independent evaluation on file'],
    areasReturned: areas.length, incompleteModelOutput: [], areas, grounded: true,
    documents: { read: 3, unreadable: 0 }, assignedIds: null, gradingCalls: 1, documentTextScale: 1
  };
}

function para(n, topic) {
  return `Fixture paragraph ${n} on ${topic}: the reviewer examined the evidence supplied by Example Remit Pty Ltd and recorded the position set out in this report, which is invented text for testing the layout and is not an assessment of any real entity.`;
}

function makeReport({ version = 1, score = 68, reportId = `2026-09-10-fixture${version}`, generatedAt = '2026-09-10T01:05:00.000Z', scoredAt = '2026-09-10T01:00:00.000Z', ghl = { fileUrl: 'https://ghl.example.test/file/v' + version, noteAdded: true }, warnings = [], notes = [] } = {}) {
  const result = makeScoreResult({ score, scoredAt });
  const rows = PROFILE_FIELDS.map((f, i) => ({ key: f.key, label: f.label, value: i % 4 === 3 ? NOT_EVIDENCED : `Fixture ${f.label.toLowerCase()}`, evidenced: i % 4 !== 3 }));
  const detailedReview = REPORT_SECTIONS.map((s, i) => ({
    key: s.key, letter: String.fromCharCode(65 + i), title: s.title, requirement: s.requirement,
    observation: para(i + 1, s.title.toLowerCase()), status: ['adequate', 'partial', 'inadequate', 'missing'][i % 4], criticalFailure: i % 5 === 0,
    questionIds: s.questionIds, builtin: true
  }));
  const fileName = `ExampleRemit_ExternalReview_Report_2026_v${version}.docx`;
  const report = {
    id: reportId, version, fileName, generatedAt, model: 'fixture-model', framework: result.framework, grounded: true,
    meta: { firmName: reportDefaults.firmName, brandName: 'Centinl', auditorName: reportDefaults.auditorName, auditorCredentials: reportDefaults.auditorCredentials, year: '2026', asAt: '2026-09-10', asAtLabel: '10 September 2026', engagementDate: '2026-09-01', engagementLabel: '1 September 2026', concludedDate: '2026-09-10', concludedLabel: '10th September 2026', scoredAt },
    entity: { legalName: 'Example Remit Pty Ltd', shortName: 'Example Remit', entityTypes: ['Independent Remittance Dealer'], entityTypeLine: 'Independent Remittance Dealer', businessSummary: 'A fictional remitter used for tests.', contactId: CONTACT_ID },
    score: { value: score, rating: result.rating, assessment: result.assessment, criticalFailures: result.criticalFailures },
    executiveSummary: [1, 2, 3, 4, 5].map((n) => para(n, 'the executive summary')),
    businessProfile: rows,
    businessOverview: [para(1, 'the business overview')],
    scope: { scopeParagraphs: [para(1, 'scope'), para(2, 'scope focus')], methodologyParagraphs: [para(1, 'methodology'), para(2, 'methodology'), para(3, 'methodology')], areasReviewed: AREAS_REVIEWED, limitationsParagraphs: [para(1, 'limitations'), para(2, 'limitations')] },
    detailedReview,
    opportunities: { intro: para(1, 'the opportunities'), items: ['Develop a fixture item one.', 'Implement a fixture item two.', 'Strengthen a fixture item three.'] },
    keyStrengths: [para(1, 'strengths'), para(2, 'strengths')],
    keyRedFlags: [para(1, 'red flags'), para(2, 'red flags')],
    overallConclusion: [para(1, 'the conclusion'), para(2, 'the conclusion'), para(3, 'the conclusion')],
    warnings, notes, scoreResult: result, ghl, documents: { read: 3, unreadable: 0 }
  };
  report.fullText = `INDEPENDENT EXTERNAL REVIEW REPORT\n${report.entity.legalName}\n\n${report.executiveSummary.join('\n\n')}`;
  return report;
}

function versionEntry(report) {
  return {
    version: report.version, reportId: report.id, fileName: report.fileName, generatedAt: report.generatedAt,
    score: report.score.value, assessment: report.score.assessment, rating: report.score.rating,
    criticalFailures: report.score.criticalFailures, model: report.model, kind: 'full', warnings: report.warnings.length, ghl: report.ghl
  };
}

module.exports = { CONTACT_ID, ADMIN_ID, adminAccount, users, contact, questions, answers, reportDefaults, makeScoreResult, makeReport, versionEntry, REPORT_SECTIONS, PROFILE_FIELDS };
