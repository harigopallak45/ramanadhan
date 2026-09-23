// A stateful fake of the API the SPA talks to, installed with page.route.
// Every endpoint a page calls is answered here, so the UI suites run with
// no backend, no GHL and no model — and the AI run's polling flow is
// deterministic: each status poll advances the job one stage.
const data = require('./data.cjs');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

class FakeBackend {
  constructor(opts = {}) {
    this.reports = new Map();       // reportId -> report
    this.versions = [];             // newest first
    this.jobs = new Map();          // jobId -> job
    this.lastJob = opts.lastJob || null;
    this.calls = [];                // every request: { method, path, body }
    this.stagesPerRun = opts.stagesPerRun || 4;
    // /health as the real backend shapes it: primary + backups with state
    this.health = opts.health || {
      success: true, configured: true, provider: 'groq', model: 'fixture-model', primary: 'groq', primaryModel: 'fixture-model',
      engine: { primary: 'groq', fallbacks: ['anthropic'], active: 'groq', activeModel: 'fixture-model', chain: [
        { provider: 'groq', model: 'fixture-model', configured: true, role: 'primary', status: 'active', restingUntil: null, lastError: null, served: 0, failed: 0 },
        { provider: 'anthropic', model: 'claude-fixture', configured: true, role: 'backup', status: 'standby', restingUntil: null, lastError: null, served: 0, failed: 0 }
      ] }
    };
    this.runningOnLoad = null;
    for (const r of opts.reports || []) this.addReport(r);
  }

  addReport(report) {
    this.reports.set(report.id, report);
    this.versions = [data.versionEntry(report), ...this.versions.filter((v) => v.version !== report.version)].sort((a, b) => b.version - a.version);
    return report;
  }

  nextVersion() { return (this.versions[0]?.version || 0) + 1; }

  startJob(kind) {
    const job = { id: `job${this.jobs.size + 1}`, kind, status: 'running', step: 0, stage: { step: 1, total: this.stagesPerRun + 2, label: 'Reading the client record and uploaded documents' }, scoreResult: null, reportId: null, version: null, ghl: null, error: null };
    this.jobs.set(job.id, job);
    return job;
  }

  // Advance one stage per poll: reading → scoring (score available) →
  // report stages → done with a new version.
  advance(job) {
    if (job.status !== 'running') return job;
    job.step += 1;
    const labels = ['Reading the client record and uploaded documents', 'Scoring the evidence against the 23 review areas', 'Extracting the business profile from the documents', 'Writing the detailed compliance review (A–F)', 'Preparing the Word document', "Saving the report to the client's GHL contact"];
    if (job.step === 2 && job.kind === 'full') job.scoreResult = data.makeScoreResult({ score: 74, scoredAt: '2026-09-15T02:00:00.000Z' });
    if (job.step >= this.stagesPerRun + 2) {
      const version = this.nextVersion();
      const report = data.makeReport({ version, score: job.kind === 'full' ? 74 : (this.versions[0]?.score ?? 68), reportId: `2026-09-15-fixture${version}`, generatedAt: '2026-09-15T02:04:00.000Z', scoredAt: job.scoreResult ? job.scoreResult.scoredAt : (this.versions[0] ? this.reports.get(this.versions[0].reportId).meta.scoredAt : '2026-09-15T02:00:00.000Z') });
      if (job.kind === 'report') report.scoreResult = null;
      this.addReport(report);
      this.versions[0].kind = job.kind;
      job.status = 'done'; job.reportId = report.id; job.version = version; job.ghl = report.ghl;
      job.stage = { step: this.stagesPerRun + 2, total: this.stagesPerRun + 2, label: labels[5] };
      this.lastJob = { status: 'done', version, finishedAt: report.generatedAt };
    } else {
      job.stage = { step: job.step, total: this.stagesPerRun + 2, label: labels[Math.min(job.step, labels.length - 1) - 1] || labels[2] };
    }
    return job;
  }

  jobView(job) {
    return { jobId: job.id, kind: job.kind, status: job.status, stage: job.stage, version: job.version, reportId: job.reportId, ghl: job.ghl, error: job.error, hasScore: !!job.scoreResult };
  }

  running() { return [...this.jobs.values()].find((j) => j.status === 'running') || null; }

  async install(page) {
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^\/hlgp/, '');
      const method = req.method();
      let body = null;
      try { body = req.postDataJSON(); } catch { body = null; }
      this.calls.push({ method, path: p, body });
      const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
      if (method === 'OPTIONS') return route.fulfill({ status: 200, body: '' });

      // ---- auth / account ----
      if (p === '/api/login' && method === 'POST') {
        if (body?.password === 'wrong') return json({ success: false, message: 'Invalid email or password.' }, 401);
        const isAdmin = /priya/.test(body?.email || '');
        return json({ success: true, token: 'fixture-token', isAdmin });
      }
      if (p === '/api/me') return json({ success: true, account: data.adminAccount });
      if (p === '/api/client/profile') return json({ success: true, contact: data.contact, done: true, isPartial: false, editingLocked: false, grantedQuestionIds: [] });

      // ---- admin ----
      if (p === '/api/admin/users' && method === 'GET') return json({ success: true, users: data.users, total: data.users.length });
      if (p === `/api/admin/users/${data.CONTACT_ID}`) return json({ success: true, contact: data.contact, activity: { lastLoginAt: '2026-09-01T00:00:00.000Z', loginCount: 3, passwordChangedAt: '2026-08-02T00:00:00.000Z' }, activityTracked: true });
      if (p === '/api/admin/progress-summary') return json({ success: true, answered: 3, total: 46, perClient: { [data.CONTACT_ID]: { answered: 3, total: 23 } } });

      // ---- rag-audit generic ----
      if (p === '/api/rag-audit/health') return json(this.health);
      if (p === '/api/rag-audit/questions') return json({ success: true, questions: data.questions.map((q) => ({ ...q, archived: false, builtin: true })), weightTotal: data.questions.length });
      if (p === '/api/rag-audit/form-schema') return json({ success: true, questions: data.questions, weightTotal: data.questions.length, assigned: false });
      if (p.startsWith('/api/rag-audit/responses/') && method === 'GET') return json({ success: true, answers: data.answers });
      if (p.startsWith('/api/rag-audit/responses/') && method === 'POST') return json({ success: true, saved: 1, skipped: [], denied: [] });
      if (p.startsWith('/api/rag-audit/edit-permissions/')) return json({ success: true, grantedQuestionIds: [] });
      if (p.startsWith('/api/rag-audit/assignments/')) return json({ success: true, assignedIds: null });
      if (p === '/api/rag-audit/report-defaults') return json({ success: true, defaults: data.reportDefaults });
      if (p.startsWith('/api/rag-audit/note/')) return json({ success: true, message: 'Logged.' });

      // ---- the AI run ----
      const score = p.match(/^\/api\/rag-audit\/score\/([^/]+)(\/.*)?$/);
      if (score) {
        const rest = score[2] || '';
        if (rest === '/run' && method === 'POST') {
          const running = this.running();
          if (running) return json({ success: true, ...this.jobView(running), reused: true }, 202);
          return json({ success: true, ...this.jobView(this.startJob('full')) }, 202);
        }
        if (rest === '/full-report' && method === 'POST') {
          if (!Array.isArray(body?.areas) || !body.areas.length) return json({ success: false, message: 'Run AI Score first, then generate the report from that result.' }, 400);
          const running = this.running();
          if (running) return json({ success: true, ...this.jobView(running), reused: true }, 202);
          return json({ success: true, ...this.jobView(this.startJob('report')) }, 202);
        }
        const st = rest.match(/^\/run\/status\/([^/]+)$/);
        if (st) {
          const job = this.jobs.get(st[1]);
          if (!job) return json({ success: false, message: 'Unknown run (it may have expired — check the versions list, or run AI Score again).' }, 404);
          this.advance(job);
          const out = { success: true, ...this.jobView(job) };
          if (job.scoreResult) out.result = job.scoreResult;
          if (job.status === 'done') out.report = this.reports.get(job.reportId);
          return json(out);
        }
        if (rest === '/runs') {
          const latestEntry = this.versions[0];
          const latest = latestEntry ? this.reports.get(latestEntry.reportId) : null;
          const running = this.runningOnLoad || this.running();
          return json({ success: true, running: running ? this.jobView(running) : null, lastJob: this.lastJob, versions: this.versions, latest: latest ? { report: latest, result: latest.scoreResult || null } : null });
        }
        if (rest === '/ghl-report-files') return json({ success: true, files: this.versions.filter((v) => v.ghl?.fileUrl).map((v) => ({ url: v.ghl.fileUrl, name: v.fileName, size: 150000, documentId: 'doc' + v.version })), fields: { files: { fieldId: 'F1' }, score: { fieldId: 'F2' } } });
        const docx = rest.match(/^\/full-report\/([^/]+)\/docx$/);
        if (docx) {
          const r = this.reports.get(docx[1]);
          if (!r) return json({ success: false, message: 'Report not found.' }, 404);
          return route.fulfill({ status: 200, headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${r.fileName}"`, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Access-Control-Allow-Origin': '*' }, body: Buffer.from('PK fixture docx') });
        }
        const one = rest.match(/^\/full-report\/([^/]+)$/);
        if (one) {
          const r = this.reports.get(one[1]);
          return r ? json({ success: true, report: r }) : json({ success: false, message: 'Report not found.' }, 404);
        }
      }

      return json({ success: false, message: `fake backend: unhandled ${method} ${p}` }, 404);
    });
  }
}

// Seed the SPA's localStorage session before the app boots.
async function seedSession(page, { admin = true } = {}) {
  await page.addInitScript(({ admin }) => {
    localStorage.setItem('jwt_token', 'fixture-token');
    localStorage.setItem('is_admin', admin ? 'true' : 'false');
  }, { admin });
}

module.exports = { FakeBackend, seedSession, DOCX_MIME };
