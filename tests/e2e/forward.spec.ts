import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("forwards a message to several chats with the sender hidden", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const body = "Release checklist: tests, docs, signed packages.";
  await expect(conversation).toContainText(body);

  await conversation.getByText(body).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Forward" })
    .click();

  const dialog = window.getByRole("dialog", { name: "Forward to" });
  await expect(dialog).toBeVisible();

  // The search field narrows the target list by title.
  await dialog.getByRole("textbox", { name: "Search chats" }).fill("notes");
  await expect(
    dialog.getByRole("button", { name: /Product Notes/ }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Telo Design/ })).toHaveCount(
    0,
  );
  await dialog.getByRole("textbox", { name: "Search chats" }).fill("");

  // Multi-target: each picked row is selected, the footer action sends once
  // per target. Hide sender maps to Telegram's dropAuthor (unit-tested on the
  // adapters; the demo strips the forwardedFrom attribution).
  await dialog.getByRole("switch", { name: "Hide sender" }).click();
  await dialog.getByRole("button", { name: /Product Notes/ }).click();
  await dialog.getByRole("button", { name: /Telo Design/ }).click();
  await dialog.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Both target chats' sidebar previews mirror the forwarded message.
  const chats = window.getByRole("navigation", { name: "Chats" });
  await expect(
    chats.getByRole("button", { name: /Product Notes/ }),
  ).toContainText(body);
  await expect(
    chats.getByRole("button", { name: /Telo Design/ }),
  ).toContainText(body);
});
