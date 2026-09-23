import { test, expect } from '@playwright/test';
import { FakeBackend, seedSession } from './fixtures/fakeBackend.cjs';

test.describe('Client portal', () => {
  test('a signed-in client sees their evidence checklist with saved answers', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await seedSession(page, { admin: false });
    await page.goto('/audit');
    // the portal opens on its landing hero; the form is behind "Enter as reporting entity"
    await page.getByRole('button', { name: 'Enter as reporting entity' }).click();
    await expect(page.getByRole('heading', { name: /Your (evidence checklist|submitted evidence)/ })).toBeVisible();
    // questions from the form schema, answers from the saved responses
    await expect(page.getByText('AML/CTF program — policies, procedures & framework').first()).toBeVisible();
    await expect(page.getByText('Program v3.1 approved June 2026').first()).toBeVisible();
    await expect(page.getByText('Example_AMLCTF_Program_v3.pdf').first()).toBeVisible();
  });

  test('a client cannot reach the admin console', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await seedSession(page, { admin: false });
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/audit$/);
  });
});
