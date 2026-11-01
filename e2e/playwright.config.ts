import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real Chromium drives the real app.
 *   - Backend: the Docker services must be running (docker compose up -d ...).
 *   - Frontend: started here with `npm run dev` unless it's already running on :3000.
 *   - Test data: global-setup.ts runs `manage.py e2e_setup` before every run.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  // One test at a time: tests share one database (same doctor calendar, same test patient).
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure", // step-by-step recording of failed tests: npx playwright show-trace
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    cwd: "../frontend",
    url: "http://localhost:3000",
    reuseExistingServer: true, // use your own `npm run dev` if it's already running
    timeout: 120_000,
  },
});
