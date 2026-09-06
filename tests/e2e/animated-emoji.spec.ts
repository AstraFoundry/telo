import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/**
 * The animated-emoji seed lives in Product Notes, alongside the three sticker
 * encodings, so one chat exercises every document the transcript can draw.
 */
async function openProductNotes(
  window: Parameters<typeof waitForDemoWorkspace>[0],
) {
  await waitForDemoWorkspace(window);
  await window.getByRole("button", { name: /Product Notes/ }).click();
}

test("draws an animated emoji smaller than a sticker and without a bubble", async ({
  window,
}) => {
  await openProductNotes(window);

  const emoji = window.getByRole("button", { name: "Play emoji animation" });
  await expect(emoji).toBeVisible();

  // An animated emoji is a character, not an attachment: Telegram draws it
  // well under sticker size, and straight onto the background.
  const box = await emoji.boundingBox();
  expect(box?.width).toBeLessThan(180);
  expect(
    await emoji.evaluate((element) =>
      Boolean(element.closest('[data-slot="message-bubble-content"]')),
    ),
  ).toBe(false);
});

test("plays the click effect over the transcript and clears it when it ends", async ({
  window,
}) => {
  await openProductNotes(window);

  const emoji = window.getByRole("button", { name: "Play emoji animation" });
  const effect = window.locator('[data-slot="animated-emoji-effect"]');

  await expect(effect).toHaveCount(0);
  await emoji.click();

  // The effect is a second document drawn far outside the row it belongs to.
  await expect(effect).toHaveCount(1);
  const size = await effect.boundingBox();
  const emojiBox = await emoji.boundingBox();
  expect(size?.width ?? 0).toBeGreaterThan((emojiBox?.width ?? 0) * 2);

  // It retires itself when the animation finishes, so the same emoji can be
  // clicked again rather than staying lit.
  await expect(effect).toHaveCount(0, { timeout: 10_000 });
});

test("draws emoji-only text large without animating it", async ({ window }) => {
  await openProductNotes(window);

  const glyphs = window.getByText("🚀🌘", { exact: true });
  await expect(glyphs).toBeVisible();
  const size = await glyphs.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  // Comfortably larger than the transcript's own text, which tops out at 18px.
  expect(size).toBeGreaterThan(24);
});
