import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";

import type { TeloDesktopApi } from "../../contracts/src/ipc";

import { demoTest, waitForDemoWorkspace } from "./fixtures";

const electronPath = createRequire(import.meta.url)("electron") as string;

const SIDEBAR_WIDTH_DEFAULT = 280;

function sidebar(window: Page) {
  return window.getByRole("complementary", { name: "Chats" });
}

function sidebarHandle(window: Page) {
  return window.getByRole("separator", { name: "Resize chat list" });
}

async function dragSidebarBy(window: Page, deltaX: number): Promise<void> {
  const box = await sidebarHandle(window).boundingBox();
  if (!box) throw new Error("sidebar resize handle has no bounding box");
  const startX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await window.mouse.move(startX, centerY);
  await window.mouse.down();
  await window.mouse.move(startX + deltaX, centerY, { steps: 5 });
  await window.mouse.up();
}

demoTest(
  "resizes the chat list column with the drag handle and resets on double-click",
  async ({ window }) => {
    await waitForDemoWorkspace(window);
    const handle = sidebarHandle(window);
    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(SIDEBAR_WIDTH_DEFAULT),
    );

    await dragSidebarBy(window, 60);

    await expect(handle).toHaveAttribute("aria-valuenow", "340");
    // The drag is direct manipulation: the column itself tracks the pointer.
    await expect
      .poll(async () => (await sidebar(window).boundingBox())?.width)
      .toBe(SIDEBAR_WIDTH_DEFAULT + 60);

    await handle.dblclick();

    await expect(handle).toHaveAttribute(
      "aria-valuenow",
      String(SIDEBAR_WIDTH_DEFAULT),
    );
    await expect
      .poll(async () => (await sidebar(window).boundingBox())?.width)
      .toBe(SIDEBAR_WIDTH_DEFAULT);
  },
);

// The shared fixtures own their application instance, so the relaunch test
// gets its own launcher that reuses one user-data directory across launches.
const relaunchTest = base.extend<{
  launchApp(): Promise<{ application: ElectronApplication; window: Page }>;
}>({
  launchApp: async ({ browserName }, use, testInfo) => {
    const applications: ElectronApplication[] = [];
    const launch = async () => {
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
          TELO_DEMO_WORKSPACE: "1",
        },
      });
      applications.push(application);
      return { application, window: await application.firstWindow() };
    };
    await use(launch);
    for (const application of applications) {
      // Instances the test already closed exit the close flow early.
      await application.close().catch(() => undefined);
    }
  },
});

relaunchTest(
  "persists the column width across an app relaunch",
  async ({ launchApp }) => {
    const first = await launchApp();
    await waitForDemoWorkspace(first.window);
    await dragSidebarBy(first.window, 60);
    // The width commits on pointer-up; wait until the main process has
    // flushed it to preferences.json before killing the app.
    await expect
      .poll(() =>
        first.window.evaluate(() =>
          (window as unknown as { telo: TeloDesktopApi }).telo.preferences
            .get()
            .then((preferences) => preferences.sidebarWidth),
        ),
      )
      .toBe(SIDEBAR_WIDTH_DEFAULT + 60);
    await first.application.close();

    const second = await launchApp();
    await waitForDemoWorkspace(second.window);
    await expect(sidebarHandle(second.window)).toHaveAttribute(
      "aria-valuenow",
      String(SIDEBAR_WIDTH_DEFAULT + 60),
    );
    await expect
      .poll(async () => (await sidebar(second.window).boundingBox())?.width)
      .toBe(SIDEBAR_WIDTH_DEFAULT + 60);
  },
);

demoTest(
  "collapses to a list ↔ conversation column below the narrow breakpoint",
  async ({ window }) => {
    await waitForDemoWorkspace(window);
    await window.setViewportSize({ width: 700, height: 900 });

    // The demo workspace auto-selects a chat, so the conversation wins the
    // single column and the chat list steps aside.
    const conversation = window.getByRole("region", { name: "Conversation" });
    await expect(conversation).toBeVisible();
    await expect(
      window.getByRole("navigation", { name: "Chats" }),
    ).toBeHidden();

    await window.getByRole("button", { name: "Back to chats" }).click();
    const chatList = window.getByRole("navigation", { name: "Chats" });
    await expect(chatList).toBeVisible();
    await expect(conversation).toBeHidden();

    await chatList.getByRole("button", { name: /Telo Design/ }).click();
    await expect(
      window.getByRole("heading", { name: "Telo Design" }),
    ).toBeVisible();
    await expect(chatList).toBeHidden();
  },
);
