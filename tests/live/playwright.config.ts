import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { trace: "retain-on-failure" },
  reporter: [["list"]],
});
