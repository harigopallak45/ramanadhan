// Playwright configuration for the Centinl portal.
//
//   npm run test:e2e          UI suites against the Vite dev server with a
//                             fake API (no backend, GHL or model needed)
//   E2E_LIVE=1 npm run test:e2e   also runs e2e/live/* against the real
//                             backend on http://localhost:5001 (read-only
//                             smoke checks; needs backend/.env)
//
// The dev server is started automatically (or reused when already up).
import { defineConfig, devices } from '@playwright/test';

const LIVE = !!process.env.E2E_LIVE;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    // vite.js is invoked directly: npm's Windows shim mis-parses the repo
    // path's ampersand ("Apps & Fullstack"), see .claude/launch.json.
    command: 'node node_modules/vite/bin/vite.js --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [
    { name: 'chromium', testIgnore: /live\//, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testMatch: /console\.spec\.js/, grep: /@mobile/, use: { ...devices['Pixel 7'] } },
    ...(LIVE ? [{ name: 'live-api', testMatch: /live\/.*\.spec\.js/, use: { baseURL: process.env.E2E_API || 'http://localhost:5001' } }] : [])
  ]
});
