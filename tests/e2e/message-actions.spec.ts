import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("replies to a message and shows the quote block on the sent message", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  const quoted = "The conversation list should stay compact at desktop widths.";
  await expect(conversation).toContainText(quoted);

  await conversation.getByText(quoted).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Reply" })
    .click();

  // The composer preview bar anchors the pending reply.
  await expect(window.getByText("Reply to Mina")).toBeVisible();

  const body = "Replying from the e2e journey.";
  const composer = window.getByLabel("Write a message…");
  await composer.fill(body);
  await composer.press("Enter");

  await expect(conversation).toContainText(body);
  await expect(window.getByText("Reply to Mina")).toHaveCount(0);
  // The quote block repeats the original sender name and body inside the new
  // bubble, so each now appears twice in the conversation.
  await expect(conversation.getByText("Mina")).toHaveCount(2);
  await expect(conversation.getByText(quoted)).toHaveCount(2);
});

test("edits an outgoing message from the context menu", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const original = "Release checklist: tests, docs, signed packages.";
  await expect(conversation).toContainText(original);

  await conversation.getByText(original).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Edit message" })
    .click();

  const composer = window.getByLabel("Write a message…");
  await expect(composer).toHaveValue(original);

  const updated = "Release checklist: tests, docs, signed packages, rollout.";
  await composer.fill(updated);
  await composer.press("Enter");

  await expect(conversation).toContainText(updated);
  await expect(conversation).toContainText("edited");
  await expect(conversation).not.toContainText(original);
});

test("keeps a failed send in the transcript and resends it from the context menu", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  // The marker makes the demo repository reject the first attempt only (see
  // DEMO_SEND_FAIL_ONCE_MARKER in the demo repository), so the Resend action
  // below drives the same body through on the retry.
  const body = "Retry me after the flap [demo-fail-once]";
  const composer = window.getByLabel("Write a message…");
  await composer.fill(body);
  await composer.press("Enter");

  // Native behavior: the undelivered bubble stays in the transcript with a
  // failed marker instead of bouncing the body back into the composer.
  await expect(conversation).toContainText(body);
  const failedGlyph = conversation.getByLabel("Message was not sent");
  await expect(failedGlyph).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(window.getByText("Telegram sync issue")).toHaveCount(0);

  await conversation.getByText(body).click({ button: "right" });
  let menu = window.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Resend" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  // A failed send never reached Telegram, so server-side actions stay hidden.
  await expect(menu.getByRole("menuitem", { name: "Reply" })).toHaveCount(0);
  await expect(
    menu.getByRole("menuitem", { name: "Edit message" }),
  ).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Forward" })).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Resend" }).click();

  // The retry succeeds and the bubble reconciles to a normal sent message.
  await expect(failedGlyph).toHaveCount(0);
  await conversation.getByText(body).click({ button: "right" });
  menu = window.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Resend" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Reply" })).toBeVisible();
});

test("deletes a message after confirming in the dialog", async ({ window }) => {
  await waitForDemoWorkspace(window);

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
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(conversation).not.toContainText(body);
});

test("forwards a message to the chat picked in the dialog", async ({
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
  // Picking a row only selects it; the footer action sends.
  await dialog.getByRole("button", { name: /Product Notes/ }).click();
  await dialog.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The target chat's sidebar preview mirrors the forwarded message.
  const target = window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Product Notes/ });
  await expect(target).toContainText(body);
});
