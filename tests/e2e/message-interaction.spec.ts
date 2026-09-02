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

/**
 * Telegram names the copy action after what the user actually selected:
 * "Copy Selected Text" over a highlighted run, "Copy Text" over the whole
 * bubble. The menu reads the selection frozen at open time, because opening it
 * moves focus and the live selection is already gone by the time an item runs.
 */
test("names the transcript copy action after the live selection", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  const body = "The retry flow needs a failed state in the transcript.";
  await expect(conversation).toContainText(body);

  const bubble = conversation.getByText(body);
  await bubble.click({ button: "right" });
  await expect(
    window.getByRole("menu").getByRole("menuitem", { name: "Copy Text" }),
  ).toBeVisible();
  await window.keyboard.press("Escape");
  // The menu portal keeps intercepting pointer events until its exit animation
  // finishes, so reopening has to wait for the close rather than race it.
  await expect(window.getByRole("menu")).toHaveCount(0);

  // Highlight the body, then reopen over it. The press has to land inside the
  // highlighted run: right-clicking outside a selection collapses it, in the
  // app exactly as in any other Chromium surface.
  await bubble.evaluate((node) => {
    // `window` here is the Playwright page fixture, not the browser global.
    const doc = node.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const selection = doc.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await bubble.click({ button: "right" });
  await expect(
    window
      .getByRole("menu")
      .getByRole("menuitem", { name: "Copy Selected Text" }),
  ).toBeVisible();
});

/**
 * Focus moves into the menu a frame after it opens, so a menu that only
 * listens for Escape on its own content stays stuck for anyone who right-clicks
 * and dismisses in the same breath. Every native menu closes on that keystroke.
 */
test("closes a right-click menu on Escape pressed before focus lands", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  const body = "The retry flow needs a failed state in the transcript.";
  await expect(conversation).toContainText(body);

  await conversation.getByText(body).click({ button: "right" });
  // No settle: the point is the keystroke that beats the focus frame.
  await window.keyboard.press("Escape");

  await expect(window.getByRole("menu")).toHaveCount(0);
});
