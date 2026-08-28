import { expect, openDemoWorkspace, test } from "./fixtures";

test("shows onboarding before opening the demo workspace and agent", async ({
  window,
}) => {
  await expect(window).toHaveTitle("Telo");
  await expect(
    window.getByRole("button", { name: "Start Messaging" }),
  ).toBeVisible();
  await openDemoWorkspace(window);
  await expect(window.getByRole("main")).toContainText("Saved Messages");
  await expect(window.getByText("Demo User")).toBeVisible();

  await window.getByRole("button", { name: "Open account menu" }).click();
  await expect(
    window.getByRole("button", { name: "Saved Messages", exact: true }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
  await expect(
    window.getByRole("heading", { name: "Telegram account" }),
  ).toBeVisible();
  await expect(
    window.getByRole("button", { name: "Open agent" }),
  ).not.toBeVisible();
  await window.getByRole("button", { name: "Back to conversation" }).click();
  await window.getByRole("button", { name: "Open agent" }).click();
  await expect(window.getByRole("heading", { name: "Agent" })).toBeVisible();
  await expect(
    window.getByRole("button", { name: "Agent settings", exact: true }),
  ).not.toBeVisible();
  await expect(window.getByText("Connect an AI provider")).toBeVisible();
  await expect(
    window.getByPlaceholder("Ask about this workspace…"),
  ).not.toBeVisible();
});

test("returns to the conversation surface when a chat is selected from Settings", async ({
  window,
}) => {
  await openDemoWorkspace(window);

  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).not.toBeVisible();
});
