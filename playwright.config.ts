import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: { trace: "retain-on-failure" },
  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/playwright", open: "never" }],
  ],
});
