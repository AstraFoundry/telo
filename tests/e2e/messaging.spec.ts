import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("sends a message from the composer into the active chat", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
  await expect(conversation).toContainText(
    "The conversation list should stay compact at desktop widths.",
  );

  const composer = window.getByLabel("Write a message…");
  const body = "Shipping the e2e messaging journey.";
  await composer.fill(body);
  await composer.press("Enter");

  await expect(conversation).toContainText(body);
  await expect(composer).toHaveValue("");
});
