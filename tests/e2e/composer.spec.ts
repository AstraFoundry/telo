import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// A 1x1 transparent PNG, staged through the clipboard as Chromium names
// pasted screenshots ("image.png").
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const COMPOSER_LABEL = "Write a message…";
const AUTO_REPLY = "Looks good — shipping it.";

test("attaches a pasted screenshot with a generated name and sends it", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const composer = window.getByLabel(COMPOSER_LABEL);
  await composer.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], "image.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", { value: dataTransfer });
    element.dispatchEvent(event);
  }, PNG_BASE64);

  // The generic clipboard name becomes a deterministic screenshot name in
  // the tray, exactly like a picker-staged attachment.
  const staged = window.getByRole("button", {
    name: /Remove attachment: screenshot-\d+\.png/,
  });
  await expect(staged).toBeVisible();

  await composer.press("Enter");

  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(
    conversation.getByRole("button", { name: /screenshot-\d+\.png/ }),
  ).toBeVisible();
  await expect(
    window.getByRole("button", { name: /Remove attachment:/ }),
  ).toHaveCount(0);
});

test("sends without sound from the send menu and no auto-reply arrives", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  // The demo counterpart only replies in the Telo Design chat.
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  const conversation = window.getByRole("region", { name: "Conversation" });
  const composer = window.getByLabel(COMPOSER_LABEL);

  // Control: a regular send makes the demo counterpart reply.
  await composer.fill("A regular hello.");
  await composer.press("Enter");
  await expect(conversation.getByText(AUTO_REPLY)).toHaveCount(1);

  // Telegram Desktop pattern: right-click the send button for send modes.
  await composer.fill("A silent hello.");
  await window
    .getByRole("button", { name: "Send prompt" })
    .click({ button: "right" });
  await window.getByRole("menuitem", { name: "Send without sound" }).click();

  await expect(conversation.getByText("A silent hello.")).toBeVisible();
  await expect(composer).toHaveValue("");

  // The demo auto-reply lands 1.4s after a normal send; a silent send must
  // leave the counterpart quiet.
  await window.waitForTimeout(2200);
  await expect(conversation.getByText(AUTO_REPLY)).toHaveCount(1);
});

test("inserts a picked emoji into the draft", async ({ window }) => {
  await waitForDemoWorkspace(window);

  const composer = window.getByLabel(COMPOSER_LABEL);
  await composer.fill("Ship it ");

  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("textbox", { name: "Search emoji…" }).fill("rocket");
  await window
    .getByRole("button", { name: "rocket launch space ship" })
    .click();

  await expect(composer).toHaveValue("Ship it 🚀");

  // The pick lands in the frequently used row for the next open.
  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await expect(window.getByText("Frequently used")).toBeVisible();
});

/**
 * Telegram's composer carries no persistent formatting strip: formatting lives
 * on the keyboard shortcuts and on the right-click menu over a selection. The
 * entities have to survive the send, which is what makes the feature real.
 */
test("formats a selection from the right-click menu and sends it", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  // No formatting buttons sit above the field.
  await expect(window.getByRole("toolbar")).toHaveCount(0);

  const field = window.getByLabel(COMPOSER_LABEL);
  await field.click();
  await field.fill("Hello team");
  await window.keyboard.press("Home");
  for (let index = 0; index < 5; index += 1) {
    await window.keyboard.press("Shift+ArrowRight");
  }

  // Right-click has to land on the selected word: clicking past it collapses
  // the selection, exactly as it does in a native field.
  const box = await field.boundingBox();
  if (!box) throw new Error("composer field has no box");
  await window.mouse.click(box.x + 24, box.y + box.height / 2, {
    button: "right",
  });

  const bold = window.getByRole("menuitemcheckbox", { name: /Bold/ });
  await expect(bold).toBeEnabled();
  await bold.click();

  // The selection survives the menu so a second format can stack on it.
  await window.mouse.click(box.x + 24, box.y + box.height / 2, {
    button: "right",
  });
  await expect(
    window.getByRole("menuitemcheckbox", { name: /Bold/ }),
  ).toHaveAttribute("aria-checked", "true");
  await window.keyboard.press("Escape");

  await field.press("Enter");
  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(conversation.locator("strong").last()).toHaveText("Hello");
});
