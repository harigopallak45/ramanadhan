// =====================================================================
// THE "AI SCORE" RUN — what one click does, as a background job:
//
//   1. read the client's record + every uploaded document (evidence.js)
//   2. score the evidence against the review areas (scorer.js)
//   3. write the Independent External Review Report (fullReport.js)
//   4. render it as Word (reportDocx.js)
//   5. save it as the next VERSION for the contact (reportStore.js) and
//      attach it to the client's GHL contact — the file into the
//      "AI Score Reports" field, the summary into "AI Score", plus a note
//
// The job object (reportStore.createJob) is updated as each stage runs,
// so the console can show a progress bar, and whoever comes back later
// finds the finished result. A GHL failure at the end never loses the
// report — it is already saved locally and the failure is recorded on the
// version for the auditor to see.
// =====================================================================
const { getEnrichedContact, addNote } = require('./ghl');
const { groupResponses } = require('./fieldMapper');
const { attachDocuments } = require('./evidence');
const { scoreResponses } = require('./scorer');
const { generateFullReport, planStageCount, fmtLongDate } = require('./fullReport');
const { renderDocx, docxFileName } = require('./reportDocx');
const reportStore = require('./reportStore');
const reportFields = require('./reportFields');
const questionBank = require('./questionBank');
const assignments = require('./assignments');

function assignedIdsFromFields(fields) {
  const fieldId = assignments.peekAssignmentFieldId();
  if (!fieldId) return null;
  const f = fields.find(x => x.id === fieldId);
  return assignments.parseAssignedIds(f?.value);
}

function entityLabelFor(contact, fallback) {
  return `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    + (contact.companyName ? ` (${contact.companyName})` : '') || contact.email || fallback;
}

// job: from reportStore.createJob(contactId, 'full' | 'report')
// opts: { options (engagement details), areas + scoredCtx (report-only runs) }
async function runJob(job, opts = {}) {
  const { contactId } = job;
  const options = opts.options || {};
  const touch = () => { try { reportStore.recordJob(contactId, job); } catch (_) { /* best effort */ } };
  let step = 0;
  let total = 0;
  const progress = label => { step++; job.stage = { step, total, label }; touch(); };

  try {
    // ---- 1. Evidence -------------------------------------------------------
    total = 4; // refined once the question list is known
    progress('Reading the client record and uploaded documents');
    const { contact, fields } = await getEnrichedContact(contactId);
    const entityLabel = opts.entityLabel || entityLabelFor(contact, contactId);
    const groups = groupResponses(fields);
    const docStats = await attachDocuments(groups);
    const assignedIds = assignedIdsFromFields(fields);
    const activeQuestions = questionBank.listActive(assignedIds);
    const reportStages = planStageCount(activeQuestions);
    total = (job.kind === 'full' ? 2 : 1) + reportStages + 2;
    job.stage = { ...job.stage, total };

    // ---- 2. Score ----------------------------------------------------------
    let scoreResult;
    let areas;
    let scoredCtx;
    if (job.kind === 'full') {
      progress(`Scoring the evidence against the ${activeQuestions.length} review areas`);
      scoreResult = await scoreResponses(groups, entityLabel, assignedIds);
      scoreResult.documents = { read: docStats.parsed, unreadable: docStats.failed };
      scoreResult.assignedIds = assignedIds;
      job.scoreResult = scoreResult;
      areas = scoreResult.areas;
      scoredCtx = { scoredAt: scoreResult.scoredAt, finalScore: scoreResult.score, rating: scoreResult.rating, criticalFailures: scoreResult.criticalFailures };
    } else {
      areas = opts.areas;
      scoredCtx = opts.scoredCtx;
      scoreResult = opts.scoreResult || null;
    }

    // ---- 3. Report ---------------------------------------------------------
    const version = reportStore.nextVersion(contactId);
    const report = await generateFullReport({
      areas, groups, activeQuestions, entityLabel, contact, scoredCtx, options,
      onProgress: s => progress(s.label)
    });
    report.version = version;
    report.documents = { read: docStats.parsed, unreadable: docStats.failed };
    if (scoreResult) report.scoreResult = scoreResult;

    // ---- 4. Word -----------------------------------------------------------
    progress('Preparing the Word document');
    const fileName = docxFileName(report, version);
    report.fileName = fileName;
    const buffer = await renderDocx(report);
    const reportId = reportStore.saveReport(contactId, report);
    reportStore.saveDocx(contactId, reportId, buffer);
    job.reportId = reportId;
    job.version = version;

    // ---- 5. GHL ------------------------------------------------------------
    progress("Saving the report to the client's GHL contact");
    const summary = `v${version} · ${report.score.value}/100 · ${report.score.assessment} · ${fmtLongDate(report.generatedAt)}`;
    let ghl;
    try {
      const attached = await reportFields.attachReportVersion(contactId, { buffer, fileName, summary });
      ghl = { ...attached, noteAdded: false };
      try {
        await addNote(contactId,
          `Centinl AI Score v${version}: ${report.score.value}/100 (${report.score.assessment}). `
          + `${report.score.criticalFailures} critical gap(s). `
          + `Independent External Review Report v${version} attached to this contact (AI Score Reports): ${fileName}. `
          + `Model: ${report.model}. Auditor review required before issue.`);
        ghl.noteAdded = true;
      } catch (e) {
        ghl.noteError = e.response?.data?.message || e.message;
      }
    } catch (e) {
      ghl = { error: e.response?.data?.message || e.message };
      console.error('[rag-audit GHL SAVE ERROR]:', ghl.error);
    }
    job.ghl = ghl;

    reportStore.saveVersion(contactId, {
      version, reportId, fileName,
      generatedAt: report.generatedAt,
      score: report.score.value, assessment: report.score.assessment, rating: report.score.rating,
      criticalFailures: report.score.criticalFailures,
      model: report.model, kind: job.kind,
      warnings: report.warnings.length,
      ghl
    });
    // The saved report carries its GHL outcome too, so reopening it later
    // shows where the file went.
    report.ghl = ghl;
    reportStore.saveReport(contactId, report);

    job.status = 'done';
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    console.error('[rag-audit AI RUN ERROR]:', msg);
    job.status = 'error';
    job.error = msg;
  } finally {
    job.finishedAt = new Date().toISOString();
    touch();
  }
  return job;
}

module.exports = { runJob };
