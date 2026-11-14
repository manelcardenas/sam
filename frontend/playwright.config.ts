import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks that jsdom cannot make — today, whether copy fits on a phone.
 * jsdom has no layout engine, so it can say a label exists but not whether it
 * fits on a 360 px screen.
 *
 * Runs against the local stack (`npm run dev` from the repo root: API on :9000,
 * web on :8080), reused if it is already up, and signs in as the seeded test
 * user (README → "First-time setup"). Files are `*.e2e.ts`, not `*.spec.ts`,
 * so Vitest's default glob never picks them up.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "./e2e/.output/results",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    cwd: "..",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
