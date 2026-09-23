import { test, expect } from '@playwright/test';
import { FakeBackend } from './fixtures/fakeBackend.cjs';

test.describe('Login', () => {
  test('renders the portal access form and rejects a bad password', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Portal Access' })).toBeVisible();
    await page.getByPlaceholder('compliance@entity.com.au').fill('sam@example-remit.test');
    await page.getByPlaceholder('••••••••').fill('wrong');
    await page.getByRole('button', { name: 'Initialize Session' }).click();
    await expect(page.locator('.auth-status.error')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an admin lands on the clients dashboard, a client on the portal', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await page.goto('/login');
    await page.getByPlaceholder('compliance@entity.com.au').fill('priya@example-audit.test');
    await page.getByPlaceholder('••••••••').fill('correct');
    await page.getByRole('button', { name: 'Initialize Session' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(await page.evaluate(() => localStorage.getItem('is_admin'))).toBe('true');

    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByPlaceholder('compliance@entity.com.au').fill('sam@example-remit.test');
    await page.getByPlaceholder('••••••••').fill('correct');
    await page.getByRole('button', { name: 'Initialize Session' }).click();
    await expect(page).toHaveURL(/\/audit$/);
  });

  test('a signed-out visitor is sent to the login page from protected routes', async ({ page }) => {
    const api = new FakeBackend();
    await api.install(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/entity/anything');
    await expect(page).toHaveURL(/\/login$/);
  });
});
