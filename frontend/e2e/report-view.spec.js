import { test, expect } from '@playwright/test';
import { FakeBackend, seedSession } from './fixtures/fakeBackend.cjs';
import data from './fixtures/data.cjs';

// The on-screen document must carry every section of the issued report,
// in the issued order, with the assessment lines and sign-off.
test.describe('External Review Report preview', () => {
  test('renders the eight sections in order with areas A–Q, the profile table and sign-off', async ({ page }) => {
    const report = data.makeReport({ version: 3, score: 79, reportId: '2026-09-14-fixture3' });
    const api = new FakeBackend({ reports: [report] });
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto(`/entity/${data.CONTACT_ID}`);

    const doc = page.locator('.fr-doc');
    await expect(doc).toBeVisible();

    // cover echo + title block
    await expect(doc.locator('.fr-cover-title')).toContainText('External Review Report');
    await expect(doc.locator('.fr-cover-entity')).toHaveText('Example Remit Pty Ltd');
    await expect(doc.getByRole('heading', { level: 1 })).toHaveText('INDEPENDENT EXTERNAL REVIEW REPORT');

    // numbered sections, in order
    const h2s = await doc.locator('h2').allTextContents();
    const numbered = h2s.filter((t) => /^\d\./.test(t));
    expect(numbered).toEqual([
      '1. Executive Summary', '2. Business Profile', '3. Scope and Methodology', '4. DETAILED COMPLIANCE REVIEW',
      '5. Opportunities for Improvement', '6. Key Strengths', '7. Key Red Flags', '8. Overall Conclusion'
    ]);

    // assessment lines appear twice (summary + conclusion) with the decided values
    await expect(doc.getByText('Overall Assessment: Effective with Moderate Enhancement Opportunities')).toHaveCount(2);
    await expect(doc.getByText('Indicative Overall Compliance Rating: 79/100')).toHaveCount(2);

    // business profile: every row of the issued table, un-evidenced rows flagged
    await expect(doc.locator('.fr-profile tbody tr')).toHaveCount(data.PROFILE_FIELDS.length);
    await expect(doc.locator('.fr-profile tbody tr').first().locator('th')).toHaveText('Legal Name');
    await expect(doc.locator('.fr-profile tr.fr-not-evidenced').first()).toContainText('Not evidenced');

    // scope sub-sections and the areas-reviewed list
    for (const h of ['3.1 Scope of the Review', '3.2 Review Methodology', '3.3 Areas Reviewed', '3.4 Review Limitations']) {
      await expect(doc.getByRole('heading', { name: h })).toBeVisible();
    }
    await expect(doc.locator('h3:has-text("3.3 Areas Reviewed") + p + ul li')).toHaveCount(report.scope.areasReviewed.length);

    // detailed review: 17 lettered areas, each with Requirement + Auditor Observation
    const areas = doc.locator('.fr-area');
    await expect(areas).toHaveCount(data.REPORT_SECTIONS.length);
    await expect(areas.first().locator('h3')).toContainText('A. Enrolment, Registration and Regulatory Status');
    await expect(areas.last().locator('h3')).toContainText('Q. Reporting Group, Branch and Affiliate Oversight Framework');
    await expect(doc.getByRole('heading', { name: 'Requirement' })).toHaveCount(17);
    await expect(doc.getByRole('heading', { name: 'Auditor Observation' })).toHaveCount(17);
    // on-screen status badges are an aid, one per area
    await expect(areas.locator('.fr-area-status')).toHaveCount(17);

    // opportunities list + sign-off
    await expect(doc.locator('h2:has-text("5. Opportunities") ~ ul').first().locator('li')).toHaveCount(3);
    await expect(doc.locator('.fr-signoff')).toContainText('Conducted by Priya Auditor CAMS');
    await expect(doc.locator('.fr-signoff')).toContainText('Electronically concluded on 10th September 2026.');
  });

  test('print mode hides everything but the document', async ({ page }) => {
    const api = new FakeBackend({ reports: [data.makeReport({ version: 1 })] });
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto(`/entity/${data.CONTACT_ID}`);
    await expect(page.locator('.fr-doc')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.body.classList.add('fr-printing'));
    const hidden = await page.locator('.ac-header').evaluate((el) => getComputedStyle(el).visibility);
    const shown = await page.locator('.fr-doc h1').evaluate((el) => getComputedStyle(el).visibility);
    expect(hidden).toBe('hidden');
    expect(shown).toBe('visible');
    const badge = await page.locator('.fr-area-status').first().evaluate((el) => getComputedStyle(el).display);
    expect(badge).toBe('none');
  });
});
