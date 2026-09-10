import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/**
 * The reaction chip row: tap feedback (the burst), the chosen state, and the
 * rolling counter. Behavior-level only — no animation internals.
 */
test("tapping an unpicked reaction celebrates with a burst and joins the tally", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  const bar = conversation.locator("[data-slot='message-reactions']").first();
  await bar.scrollIntoViewIfNeeded();

  const chip = bar.getByRole("button", { name: /🎉/ });
  await expect(chip).toHaveAttribute("aria-pressed", "false");

  await chip.click();

  // The burst: the glyph appears a second time, above the chip, briefly.
  await expect(conversation.getByText("🎉")).toHaveCount(2);
  // The tally joins: the chip reads 🎉 2 and is marked as the account's own.
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip.locator(".sr-only")).toHaveText("2");

  // The burst retires itself; only the chip's glyph remains.
  await expect(conversation.getByText("🎉")).toHaveCount(1, {
    timeout: 4000,
  });
});

test("tapping the account's own reaction removes it without a burst", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  const bar = conversation.locator("[data-slot='message-reactions']").first();
  await bar.scrollIntoViewIfNeeded();

  const chip = bar.getByRole("button", { name: /👍/ });
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  await chip.click();

  // No celebration on removal: the glyph never doubles.
  await expect(conversation.getByText("👍")).toHaveCount(1);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(chip.locator(".sr-only")).toHaveText("1");
});

test("the burst keeps a gentler glyph pop under reduced motion", async ({
  window,
}) => {
  await window.emulateMedia({ reducedMotion: "reduce" });
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  const conversation = window.getByRole("region", { name: "Conversation" });
  const bar = conversation.locator("[data-slot='message-reactions']").first();
  await bar.scrollIntoViewIfNeeded();

  const chip = bar.getByRole("button", { name: /🎉/ });
  await chip.click();

  // Reduced motion drops the particle spray but keeps the feedback: the
  // glyph still appears above the chip, then retires.
  await expect(conversation.getByText("🎉")).toHaveCount(2);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

test("Saved Messages offers no mute action", async ({ window }) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Saved Messages/ })
    .first()
    .click({ button: "right" });

  const menu = window.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Mute" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Pin" })).toBeVisible();
  await window.keyboard.press("Escape");
});
