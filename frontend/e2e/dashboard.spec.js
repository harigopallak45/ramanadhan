import { test, expect } from '@playwright/test';
import { FakeBackend, seedSession } from './fixtures/fakeBackend.cjs';
import data from './fixtures/data.cjs';

test.describe('Clients dashboard', () => {
  test('lists clients with their status and the AI engine chip', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto('/admin');
    await expect(page.getByText('Example Remit Pty Ltd').first()).toBeVisible();
    await expect(page.getByText('Example FX Pty Ltd').first()).toBeVisible();
    // the admin row is not listed among clients
    await expect(page.locator('table').getByText('Example Audit Firm')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View' }).first()).toHaveAttribute('href', `/entity/${data.CONTACT_ID}`);
    // engine chip: primary serving, one backup on standby
    await expect(page.locator('.ad-engine-chip')).toHaveText('✓ AI ready · 1 backup');
    await expect(page.locator('.ad-engine-chip')).toHaveAttribute('title', /backup: anthropic · claude-fixture — standby/);
  });

  test('the engine chip warns when the primary is resting and a backup is serving', async ({ page }) => {
    const api = new FakeBackend({ health: {
      success: true, configured: true, provider: 'anthropic', model: 'claude-fixture', primary: 'groq', primaryModel: 'fixture-model',
      engine: { primary: 'groq', fallbacks: ['anthropic'], active: 'anthropic', activeModel: 'claude-fixture', chain: [
        { provider: 'groq', model: 'fixture-model', configured: true, role: 'primary', status: 'resting', restingUntil: '2026-09-21T01:05:00.000Z', lastError: 'groq transport error: upstream unavailable', served: 3, failed: 1 },
        { provider: 'anthropic', model: 'claude-fixture', configured: true, role: 'backup', status: 'active', restingUntil: null, lastError: null, served: 2, failed: 0 }
      ] }
    } });
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto('/admin');
    const chip = page.locator('.ad-engine-chip');
    await expect(chip).toHaveText('⚠ AI on backup (anthropic)');
    await expect(chip).toHaveClass(/backup/);
    await expect(chip).toHaveAttribute('title', /primary: groq · fixture-model — resting/);
  });

  test('the engine chip reports when no model key is configured', async ({ page }) => {
    const api = new FakeBackend({ health: { success: true, configured: false, provider: 'groq', model: 'openai/gpt-oss-120b', engine: { primary: 'groq', fallbacks: [], active: 'groq', chain: [] } } });
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto('/admin');
    await expect(page.locator('.ad-engine-chip')).toHaveText('AI not set up');
  });

  test('a row\'s AI Score starts the full run and opens that client\'s console', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await seedSession(page, { admin: true });
    await page.goto('/admin');
    const row = page.locator('tr', { hasText: 'Example Remit Pty Ltd' });
    await row.getByRole('button', { name: /AI Score/ }).click();
    await expect(page).toHaveURL(new RegExp(`/entity/${data.CONTACT_ID}$`));
    // the run was started before navigating, and the console shows its progress
    expect(api.calls.some((c) => c.method === 'POST' && c.path === `/api/rag-audit/score/${data.CONTACT_ID}/run`)).toBe(true);
    await expect(page.locator('.ac-run')).toBeVisible();
    await expect(page.getByRole('button', { name: /Running…/ })).toBeDisabled();
  });
});
