import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

const COMMAND = process.platform === "darwin" ? "Meta" : "Control";

test("replies to a message from the hover rail", async ({ window }) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  const quoted = "The conversation list should stay compact at desktop widths.";
  await expect(conversation).toContainText(quoted);

  const row = window.locator("#conversation-message-design-1");
  await row.hover();
  await row.getByRole("button", { name: "Reply" }).click();

  // The composer preview bar anchors the pending reply.
  await expect(window.getByText("Reply to Mina")).toBeVisible();
});

test("opens the command palette with Cmd+K and jumps to a chat", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window.keyboard.press(`${COMMAND}+K`);
  const field = window.getByRole("combobox", { name: "Search everywhere" });
  await expect(field).toBeVisible();

  await field.fill("Product Notes");
  const option = window.getByRole("option", { name: /Product Notes/ });
  await expect(option).toBeVisible();
  await window.keyboard.press("Enter");

  // The palette closes and the chat opens.
  await expect(field).toHaveCount(0);
  await expect(
    window.getByRole("heading", { name: "Product Notes" }),
  ).toBeVisible();
});

test("multi-selects messages and batch-deletes them", async ({ window }) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  const first = "The retry flow needs a failed state in the transcript.";
  const second = "And the unread divider has to survive paging.";
  await expect(conversation).toContainText(first);
  await expect(conversation).toContainText(second);

  await conversation.getByText(first).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Select" })
    .click();

  const bar = window.getByRole("region", { name: "Selection actions" });
  await expect(bar).toContainText("1 selected");

  await window
    .locator("#conversation-message-design-5")
    .getByRole("button", { name: "Select" })
    .click();
  await expect(bar).toContainText("2 selected");

  await bar.getByRole("button", { name: "Delete" }).click();
  const dialog = window.getByRole("dialog");
  await expect(
    dialog.getByText("Delete the selected messages? This cannot be undone."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(conversation).not.toContainText(first);
  await expect(conversation).not.toContainText(second);
});

test("deletes an outgoing message for everyone from the dialog", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  // Saved Messages is the default active chat; its fixture is outgoing.
  const conversation = window.getByRole("region", { name: "Conversation" });
  const body = "Release checklist: tests, docs, signed packages.";
  await expect(conversation).toContainText(body);

  await conversation.getByText(body).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Delete" })
    .click();

  const dialog = window.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Outgoing messages offer both scopes, defaulting to everyone.
  const everyone = dialog.getByRole("radio", { name: "Delete for everyone" });
  await expect(everyone).toBeChecked();
  await expect(
    dialog.getByRole("radio", { name: "Delete for me" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(conversation).not.toContainText(body);
});
