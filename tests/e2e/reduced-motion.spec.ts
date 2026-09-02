import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

const COMPOSER_LABEL = "Write a message…";
const QUOTED = "The conversation list should stay compact at desktop widths.";

/**
 * The motion-heavy surfaces must stay operable when the OS asks for reduced
 * motion. Each animated affordance owes a static alternative, so the risk this
 * covers is an element that only becomes visible or clickable as its
 * transition runs — under `reduce` that transition never plays.
 */
test("drives the animated surfaces with reduced motion enabled", async ({
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
  const composer = window.getByLabel(COMPOSER_LABEL);

  // Emoji picker: the popover morph and the per-cell press spring both drop
  // out, leaving the grid to behave as a plain list of buttons.
  await composer.fill("Ship it ");
  await window.getByRole("button", { name: "Emoji and stickers" }).click();
  await window.getByRole("textbox", { name: "Search emoji…" }).fill("rocket");
  await window
    .getByRole("button", { name: "rocket launch space ship" })
    .click();
  await expect(composer).toHaveValue("Ship it 🚀");
  await composer.fill("");

  // Media viewer: the origin morph collapses to a fade, so the dialog has to
  // appear without the shared-element transition that normally places it.
  await conversation.hover();
  await window.mouse.wheel(0, -100_000);
  const photo = conversation.getByRole("button", { name: "telo-hero.png" });
  await expect(photo).toBeVisible();
  await photo.click();
  const viewer = window.getByRole("dialog", { name: "Media viewer" });
  await expect(viewer).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Reply quote: a pressable block whose press scale is suppressed but whose
  // jump target must still resolve.
  await expect(conversation).toContainText(QUOTED);
  await conversation.getByText(QUOTED).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Reply" })
    .click();
  await composer.fill("Replying with reduced motion.");
  await composer.press("Enter");

  const jump = window.getByRole("button", { name: "Jump to original message" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(conversation.getByText(QUOTED).first()).toBeInViewport();

  // A video sticker normally loops on its own. Under reduce it holds its
  // first frame, so the only way to see it move is the play control — the
  // gentler alternative, not a missing sticker.
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Product Notes/ })
    .click();
  const stickers = window.getByRole("region", { name: "Conversation" });
  await expect(stickers.getByRole("img", { name: "👋" })).toBeVisible();
  await expect(
    stickers.getByRole("button", { name: "Play sticker" }).first(),
  ).toBeVisible();
});
