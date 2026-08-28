import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";

const electronPath = createRequire(import.meta.url)("electron") as string;

interface ElectronFixtures {
  application: ElectronApplication;
  window: Page;
}

export const test = base.extend<ElectronFixtures>({
  application: async ({ browserName }, use, testInfo) => {
    const application = await electron.launch({
      executablePath: electronPath,
      args: [
        ".",
        `--user-data-dir=${testInfo.outputPath(`${browserName}-user-data`)}`,
      ],
      env: {
        ...process.env,
        // safeStorage has no keychain under Playwright; fall back to plain
        // base64 so the specs can exercise the secret-storage round trip.
        TELO_PLAINTEXT_SECRETS: "1",
      },
    });
    await use(application);
    await application.close();
  },
  window: async ({ application }, use) => {
    await use(await application.firstWindow());
  },
});

export { expect };

export async function openDemoWorkspace(window: Page): Promise<void> {
  await expect(
    window.getByRole("heading", { name: "Sign in to Telegram" }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Use demo workspace" }).click();
  await expect(window.getByRole("navigation", { name: "Chats" })).toBeVisible();
}
