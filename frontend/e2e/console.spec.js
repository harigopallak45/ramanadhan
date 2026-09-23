import { test, expect } from '@playwright/test';
import { FakeBackend, seedSession } from './fixtures/fakeBackend.cjs';
import data from './fixtures/data.cjs';

const consoleUrl = `/entity/${data.CONTACT_ID}`;

async function openConsole(page, api) {
  await api.install(page);
  await seedSession(page, { admin: true });
  await page.goto(consoleUrl);
  await expect(page.getByRole('heading', { name: 'Sam Client' })).toBeVisible();
}

test.describe('Auditor console — AI run, report and versions', () => {
  test('shows the latest saved version, its score and the engagement details on load', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 }), data.makeReport({ version: 2, score: 71, reportId: '2026-09-12-fixture2', generatedAt: '2026-09-12T03:00:00.000Z', scoredAt: '2026-09-12T02:55:00.000Z' })] });
    await openConsole(page, api);

    // scorecard from the saved score
    await expect(page.locator('.ac-score-big')).toContainText('71');
    await expect(page.locator('.ac-assessment')).toContainText('Effective with Moderate Enhancement Opportunities');

    // report panel shows v2 and the GHL filing line
    const bar = page.locator('.frp-report-bar');
    await expect(bar).toContainText('v2');
    await expect(bar).toContainText('71/100');
    await expect(page.locator('.frp-filed')).toContainText('ExampleRemit_ExternalReview_Report_2026_v2.docx');
    await expect(page.getByRole('button', { name: 'Versions (2)' })).toBeVisible();

    // engagement details prefilled from the server defaults
    await page.locator('.ac-engagement-toggle').click();
    await expect(page.getByPlaceholder('Name printed on the sign-off')).toHaveValue('Priya Auditor');
    await expect(page.getByPlaceholder('Named in the executive summary')).toHaveValue('Example Audit Firm');
  });

  test('AI Score runs the whole job with progress, shows the score early, then files a new version', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })], stagesPerRun: 4 });
    await openConsole(page, api);

    // set an engagement date so we can assert it is sent with the run
    await page.locator('.ac-engagement-toggle').click();
    await page.getByLabel('Statement of Engagement dated').fill('2026-09-01');

    const aiButton = page.locator('.ac-actions button', { hasText: 'AI Score' });
    await aiButton.click();

    // progress card with stage label and step counter; button locked
    const run = page.locator('.ac-run');
    await expect(run).toBeVisible();
    await expect(run).toContainText('AI Score run');
    await expect(run.locator('.progress > div')).toBeVisible();
    await expect(page.locator('.ac-actions button', { hasText: 'Running…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Upload documents' })).toBeDisabled();

    // the scorecard flips to the fresh score while the report is still being written
    await expect(page.locator('.ac-score-big')).toContainText('74');
    await expect(run).toBeVisible();

    // …and the run completes with a new version
    await expect(run).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('.frp-report-bar')).toContainText('v2');
    await expect(page.locator('.frp-report-bar')).toContainText('74/100');
    await expect(page.getByRole('button', { name: 'Versions (2)' })).toBeVisible();
    await expect(page.getByText('AI run complete — report v2 filed')).toBeVisible();
    await expect(page.locator('.ac-actions button', { hasText: 'AI Score' })).toBeEnabled();

    // the engagement details travelled with the run
    const start = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/run'));
    expect(start.body.options.engagementDate).toBe('2026-09-01');
    expect(start.body.options.auditorName).toBe('Priya Auditor');
  });

  test('a run still in progress is picked up again after a reload', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })], stagesPerRun: 8 });
    await openConsole(page, api);
    await page.locator('.ac-actions button', { hasText: 'AI Score' }).click();
    await expect(page.locator('.ac-run')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sam Client' })).toBeVisible();
    await expect(page.locator('.ac-run')).toBeVisible();
    await expect(page.locator('.ac-run')).toContainText(/step \d+ of \d+/);
    await expect(page.locator('.ac-run')).toBeHidden({ timeout: 45_000 });
    await expect(page.locator('.frp-report-bar')).toContainText('v2');
  });

  test('a second click while running reuses the job instead of starting another', async ({ page }) => {
    const api = new FakeBackend({ stagesPerRun: 6 });
    await openConsole(page, api);
    const button = page.locator('.ac-actions button', { hasText: 'AI Score' });
    await button.click();
    await expect(page.locator('.ac-run')).toBeVisible();
    await expect(page.locator('.ac-actions button', { hasText: 'Running…' })).toBeDisabled();
    // force-click through the disabled state — the fake returns the same job
    await page.locator('.ac-actions button', { hasText: 'Running…' }).click({ force: true });
    expect(api.jobs.size).toBe(1);
  });

  test('an interrupted run (server restarted) is reported and can be re-run', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })], lastJob: { status: 'running', stage: { step: 2, total: 11, label: 'Scoring the evidence against the 23 review areas' } } });
    await openConsole(page, api);
    await expect(page.locator('.ac-ai-warn--pending')).toContainText('A previous AI run was interrupted');
    await expect(page.locator('.ac-ai-warn--pending')).toContainText('scoring the evidence');
    await expect(page.locator('.ac-actions button', { hasText: 'AI Score' })).toBeEnabled();
    await expect(page.locator('.frp-report-bar')).toContainText('v1');
  });

  test('versions: view an older one, download its Word file, see the GHL copy', async ({ page }) => {
    const v1 = data.makeReport({ version: 1 });
    const v2 = data.makeReport({ version: 2, score: 71, reportId: '2026-09-12-fixture2', generatedAt: '2026-09-12T03:00:00.000Z', scoredAt: '2026-09-12T02:55:00.000Z' });
    const api = new FakeBackend({ reports: [v1, v2] });
    await openConsole(page, api);

    await page.getByRole('button', { name: 'Versions (2)' }).click();
    const table = page.locator('.frp-versions-table');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('tbody tr').nth(0)).toContainText('v2');
    await expect(table.locator('tbody tr').nth(1)).toContainText('v1');
    await expect(table.getByRole('link', { name: 'Filed ✓' })).toHaveCount(2);
    await expect(page.getByText('GHL holds 2 files')).toBeVisible();

    // view v1 → report and scorecard switch
    await table.locator('tbody tr', { hasText: 'v1' }).getByRole('button', { name: 'View' }).click();
    await expect(page.locator('.frp-report-bar')).toContainText('v1');
    await expect(page.locator('.ac-score-big')).toContainText('68');

    // Word download carries the version's filename
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.frp-report-bar').getByRole('button', { name: 'Download Word (.docx)' }).click()
    ]);
    expect(download.suggestedFilename()).toBe('ExampleRemit_ExternalReview_Report_2026_v1.docx');
    await expect(page.getByText('Downloaded ExampleRemit_ExternalReview_Report_2026_v1.docx')).toBeVisible();
  });

  test('"New version (same score)" writes a report-only version around the current score', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })], stagesPerRun: 3 });
    await openConsole(page, api);
    await page.getByRole('button', { name: 'New version (same score)' }).click();
    await expect(page.locator('.ac-run')).toContainText('writing a new report version');
    await expect(page.locator('.ac-run')).toBeHidden({ timeout: 30_000 });
    const start = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/full-report'));
    expect(start.body.areas.length).toBe(23);
    await expect(page.locator('.frp-report-bar')).toContainText('v2');
    await page.getByRole('button', { name: 'Versions (2)' }).click();
    await expect(page.locator('.frp-versions-table tbody tr').nth(0)).toContainText('report only');
  });

  test('draft notes and informational notes are shown for the auditor', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1, warnings: ['No observation was returned for Q. Reporting Group, Branch and Affiliate Oversight Framework; the scorecard finding was printed instead.'], notes: ['Document excerpts for areas A–F were shortened to fit the model\'s token limit.'] })] });
    await openConsole(page, api);
    await expect(page.getByText('Draft notes — review before issue:')).toBeVisible();
    await expect(page.getByText('No observation was returned for Q.')).toBeVisible();
    await expect(page.getByText(/shortened to fit the model/)).toBeVisible();
  });

  test('@mobile the console has no horizontal overflow with a report on screen', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })] });
    await openConsole(page, api);
    await expect(page.locator('.fr-doc')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
