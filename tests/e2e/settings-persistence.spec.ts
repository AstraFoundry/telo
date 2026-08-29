import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("persists Agent settings across Settings visits", async ({ window }) => {
  await waitForDemoWorkspace(window);

  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();

  // The form backfills asynchronously once the stored configuration loads;
  // wait for the default instructions before typing into the fields.
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
  await window.getByLabel("Model").fill("gpt-4.1-e2e");
  await window
    .getByLabel("Instructions")
    .fill("E2E persistence check instructions.");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();

  // The form remounts with defaults and backfills again; the persisted
  // values must win once the stored configuration loads.
  await expect(window.getByLabel("Model")).toHaveValue("gpt-4.1-e2e");
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "E2E persistence check instructions.",
  );
});
