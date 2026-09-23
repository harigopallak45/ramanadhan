import { test, expect } from '@playwright/test';
import path from 'path';
import { createRequire } from 'module';

// Read-only smoke checks against the REAL backend (E2E_LIVE=1). They never
// start an AI run — that costs minutes and model tokens and writes to GHL —
// but they prove auth, config, the run/version endpoints and the Word
// download work on the running server with its real .env.
//
//   E2E_LIVE=1 [E2E_CONTACT=<contactId>] npx playwright test --project=live-api
//
// A local admin token is minted from backend/.env's JWT_SECRET, exactly as
// the server would issue one — so this only runs where the .env lives.
const require = createRequire(import.meta.url);
const backendDir = path.join(process.cwd(), '..', 'backend');
require(path.join(backendDir, 'node_modules', 'dotenv')).config({ path: path.join(backendDir, '.env') });
const jwt = require(path.join(backendDir, 'node_modules', 'jsonwebtoken'));

const secret = process.env.JWT_SECRET;
const adminToken = secret ? jwt.sign({ id: 'e2e-admin', email: 'e2e@local', role: 'admin' }, secret, { expiresIn: '10m' }) : '';
const clientToken = secret ? jwt.sign({ id: 'e2e-client', email: 'e2e@local', role: 'user' }, secret, { expiresIn: '10m' }) : '';
const H = { Authorization: `Bearer ${adminToken}` };

test.describe('Live backend smoke', () => {
  test.skip(!secret, 'backend/.env with JWT_SECRET is required');

  test('rejects missing and non-admin tokens on AI routes', async ({ request }) => {
    expect((await request.get('/api/rag-audit/health')).status()).toBe(401);
    expect((await request.get('/api/rag-audit/health', { headers: { Authorization: `Bearer ${clientToken}` } })).status()).toBe(403);
    expect((await request.get('/api/rag-audit/health', { headers: { Authorization: 'Bearer not-a-token' } })).status()).toBe(403);
  });

  test('reports the configured engine and the report defaults', async ({ request }) => {
    const h = await (await request.get('/api/rag-audit/health', { headers: H })).json();
    expect(h.success).toBe(true);
    expect(typeof h.configured).toBe('boolean');
    expect(h.model).toBeTruthy();
    const d = await (await request.get('/api/rag-audit/report-defaults', { headers: H })).json();
    expect(d.defaults.auditorName).toBeTruthy();
    expect(d.defaults.firmName).toBeTruthy();
  });

  test('unknown run job → 404, invalid contact id → 400', async ({ request }) => {
    const r = await request.get('/api/rag-audit/score/someContact/run/status/nope', { headers: H });
    expect(r.status()).toBe(404);
    const bad = await request.post('/api/rag-audit/score/not%20valid!/run', { headers: H, data: {} });
    expect([400, 503]).toContain(bad.status()); // 503 when no model key is configured on this host
  });

  test('report-only run without a score is refused', async ({ request }) => {
    const r = await request.post('/api/rag-audit/score/someContact/full-report', { headers: H, data: { areas: [] } });
    expect([400, 503]).toContain(r.status());
  });

  test('a contact with saved versions serves its state and Word file', async ({ request }) => {
    const contactId = process.env.E2E_CONTACT;
    test.skip(!contactId, 'set E2E_CONTACT to a contact id that has at least one saved version');
    const runs = await (await request.get(`/api/rag-audit/score/${contactId}/runs`, { headers: H })).json();
    expect(runs.success).toBe(true);
    expect(Array.isArray(runs.versions)).toBe(true);
    if (!runs.versions.length) test.skip(true, 'no versions saved for this contact yet');
    const v = runs.versions[0];
    expect(runs.latest.report.id).toBe(v.reportId);
    expect(runs.latest.report.detailedReview.length).toBeGreaterThan(0);
    expect(runs.latest.report.businessProfile.length).toBe(23);

    const docx = await request.get(`/api/rag-audit/score/${contactId}/full-report/${v.reportId}/docx`, { headers: H });
    expect(docx.status()).toBe(200);
    expect(docx.headers()['content-type']).toContain('wordprocessingml');
    expect(docx.headers()['content-disposition']).toContain(v.fileName);
    const body = await docx.body();
    expect(body.length).toBeGreaterThan(50_000);
    expect(body.slice(0, 2).toString()).toBe('PK'); // a zip container, i.e. a real .docx

    const files = await (await request.get(`/api/rag-audit/score/${contactId}/ghl-report-files`, { headers: H })).json();
    expect(files.success).toBe(true);
    expect(files.files.some((f) => f.name === v.fileName)).toBe(!!v.ghl?.fileUrl);
  });
});
