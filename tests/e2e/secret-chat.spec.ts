import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("opens the demo secret chat and shows the lock", async ({ window }) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Secret chat/ })
    .click();

  await expect(window.getByRole("heading", { name: "Mina" })).toBeVisible();
  await expect(
    window.getByText("End-to-end encrypted, device-local"),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(conversation).toContainText(
    "This chat is end-to-end encrypted.",
  );

  const composer = window.getByLabel("Write a message…");
  await composer.fill("Secret note from Telo.");
  await composer.press("Enter");
  await expect(conversation).toContainText("Secret note from Telo.");
});
