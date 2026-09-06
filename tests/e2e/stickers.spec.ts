import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/**
 * Telegram draws a sticker as the message itself: no bubble, no file name, no
 * download button. The demo chat carries one sticker per encoding — still,
 * gzipped Lottie and WebM — so this covers all three render paths plus the
 * composer's send path.
 */
test("renders every sticker encoding without an attachment card", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Product Notes/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Product Notes" }),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  // The bubble-less sticker messages. Four of them: one per encoding, plus
  // the animated emoji seeded after them, which the same primitive draws but
  // which is Telegram's rendering of a typed character rather than a fourth
  // encoding. The chat also carries an inline custom emoji, which lives
  // inside a bubble and is counted separately below.
  const stickers = conversation.locator(
    '[data-slot="message-sticker"] [data-slot="sticker"]',
  );
  await expect(stickers).toHaveCount(4);

  // Still and video stickers resolve to their own elements; the Lottie one
  // renders an SVG once the player has gunzipped and parsed the document.
  await expect(stickers.nth(0).locator("img")).toBeVisible();
  await expect(stickers.nth(1).locator("svg")).toBeVisible();
  await expect(stickers.nth(2).locator("video")).toBeVisible();

  // Never the attachment card: no file name, no byte count, no download.
  await expect(conversation).not.toContainText("wave.png");
  await expect(
    conversation.getByRole("button", { name: "Download attachment" }),
  ).toHaveCount(0);

  // The bubble belongs to the text message only; the stickers sit bare.
  await expect(
    conversation.locator('[data-slot="message-bubble"]'),
  ).toHaveCount(2);
});

test("sends a sticker from the composer picker", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(conversation.locator('[data-slot="sticker"]')).toHaveCount(0);

  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("button", { name: "Stickers", exact: true }).click();
  const cell = window.getByRole("button", { name: "👋" });
  await expect(cell).toBeVisible();
  await cell.click();

  // The picked sticker lands in the transcript as an outgoing message, and it
  // reuses the picker's cached document so it paints without a placeholder.
  const sent = conversation.locator('[data-slot="sticker"]');
  await expect(sent).toHaveCount(1);
  await expect(sent.locator("img")).toBeVisible();
});

test("previews and favorites a sticker from the picker", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("button", { name: "Stickers", exact: true }).click();
  const sticker = window.getByRole("button", { name: "🎉", exact: true });
  await expect(sticker).toBeVisible();
  await sticker.click({ button: "right" });
  await window.getByRole("menuitem", { name: "Preview sticker" }).click();

  const preview = window.getByRole("dialog", { name: "Preview sticker" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Add to favorites" }).click();
  await expect(
    preview.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();
});

test("holds and scrubs sticker previews without sending", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  const conversation = window.getByRole("region", { name: "Conversation" });
  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("button", { name: "Stickers", exact: true }).click();
  const first = window.getByRole("button", { name: "👋", exact: true });
  const second = window.getByRole("button", { name: "🎉", exact: true });

  await first.hover();
  await window.mouse.down();
  await window.waitForTimeout(450);
  const preview = window.locator('[data-slot="sticker-hold-preview"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("z-index", "10002");
  await expect(preview).toHaveAttribute("data-preview-sticker-id", "sticker/1");

  const secondBox = await second.boundingBox();
  if (!secondBox) throw new Error("Second sticker is not visible");
  await window.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await expect(preview).toHaveAttribute("data-preview-sticker-id", "sticker/2");

  await window.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(conversation.locator('[data-slot="sticker"]')).toHaveCount(0);
});

test("searches Telegram stickers from the picker", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("button", { name: "Stickers", exact: true }).click();
  await window.getByRole("textbox", { name: "Search stickers…" }).fill("party");

  await expect(window.getByText("Sticker search results")).toBeVisible();
  await expect(
    window.getByRole("button", { name: "🎉", exact: true }),
  ).toBeVisible();
});

test("opens a received sticker's set and toggles it", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Product Notes/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });

  // Telegram opens the set when you tap a sticker. What the chat holds
  // besides that sticker is the encoding test's business, not this one's.
  const openSet = conversation
    .getByRole("button", { name: "Open sticker set" })
    .first();
  await expect(openSet).toBeVisible();
  await openSet.click();
  const sheet = window.getByRole("dialog", { name: "Telo Pack" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-slot="sticker"]')).toHaveCount(3);

  // The demo account has the set installed, so the action removes it, and the
  // label flips to match the new state.
  const remove = sheet.getByRole("button", { name: "Remove stickers" });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(
    sheet.getByRole("button", { name: "Add stickers" }),
  ).toBeVisible();
});

test("draws a custom emoji inline in the sentence", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Product Notes/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });

  // The demo message reads "Shipping 🎉" with the glyph covered by a
  // custom-emoji entity pointing at the animated sticker document.
  const row = conversation.getByText("Shipping").locator("..");
  await expect(row).toBeVisible();

  // Once the document resolves it is drawn at line height, in the sentence,
  // not as an attachment below it.
  const inline = conversation
    .locator('[data-slot="message-bubble"] [data-slot="sticker"]')
    .first();
  await expect(inline).toBeVisible();
  const box = await inline.boundingBox();
  expect(box?.width).toBe(20);
});
