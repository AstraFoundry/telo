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

function createTest(demoWorkspace: boolean) {
  return base.extend<ElectronFixtures>({
    application: async ({ browserName }, use, testInfo) => {
      const application = await electron.launch({
        executablePath: electronPath,
        args: [
          // GitHub-hosted Linux runners cannot use Chromium's sandbox.
          ...(process.env.CI ? ["--no-sandbox"] : []),
          ".",
          `--user-data-dir=${testInfo.outputPath(`${browserName}-user-data`)}`,
        ],
        env: {
          ...process.env,
          // safeStorage has no keychain under Playwright; fall back to plain
          // base64 so the specs can exercise the secret-storage round trip.
          TELO_PLAINTEXT_SECRETS: "1",
          TELO_E2E: "1",
          // Demo workspace is a launch flag, not an onboarding button.
          TELO_DEMO_WORKSPACE: demoWorkspace ? "1" : "",
        },
      });
      await use(application);
      await application.close();
    },
    window: async ({ application }, use) => {
      await use(await application.firstWindow());
    },
  });
}

export const test = createTest(false);
export const demoTest = createTest(true);

export { expect };

export async function waitForDemoWorkspace(window: Page): Promise<void> {
  await expect(window.getByRole("navigation", { name: "Chats" })).toBeVisible();
}

/** Avatar menu -> Settings -> Agent, the entry point a reader actually uses. */
export async function openAgentSettings(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("button", { name: "Agent settings" }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
}

/** Fixture OAuth Connect for the default OpenAI account (`TELO_E2E=1`). */
export async function connectDemoAgentAccount(window: Page): Promise<void> {
  await openAgentSettings(window);
  await window.getByRole("button", { name: "Connect account" }).click();
  await expect(window.getByText("e2e@example.com")).toBeVisible();
  await window.getByRole("button", { name: "Back to conversation" }).click();
}
