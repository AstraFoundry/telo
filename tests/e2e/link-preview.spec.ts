import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("shows the link preview card as a safe external link", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  const card = conversation.getByRole("link", {
    name: /Spacing is a system, not a vibe/,
  });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute(
    "href",
    "https://example.com/spacing-craft",
  );
  await expect(card).toHaveAttribute("target", "_blank");
  await expect(card).toHaveAttribute("rel", "noreferrer");
  await expect(card).toContainText("Example Journal");
  await expect(card).toContainText("example.com/spacing-craft");

  // A link preview is not a downloadable attachment.
  await expect(
    conversation.getByRole("button", { name: "Download attachment" }),
  ).toHaveCount(0);
});
