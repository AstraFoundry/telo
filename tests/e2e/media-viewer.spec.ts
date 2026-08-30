import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

async function openDesignChat(window: import("@playwright/test").Page) {
  await waitForDemoWorkspace(window);
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
  return window.getByRole("region", { name: "Conversation" });
}

test("opens the viewer from a photo bubble and closes with Escape", async ({
  window,
}) => {
  const conversation = await openDesignChat(window);

  // The thumbnail auto-preloads once the bubble is visible, then renders as
  // a clickable photo.
  const photo = conversation.getByRole("button", { name: "telo-hero.png" });
  await expect(photo).toBeVisible();
  await photo.click();

  const viewer = window.getByRole("dialog", { name: "Media viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute(
    "src",
    /^telo-media:\/\/cache\/design_media-1\.png/,
  );
  await expect(viewer.getByRole("button", { name: "Open" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Save as…" })).toBeVisible();

  await window.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("navigates between the chat's media with arrow keys", async ({
  window,
}) => {
  const conversation = await openDesignChat(window);

  const photo = conversation.getByRole("button", { name: "telo-hero.png" });
  await expect(photo).toBeVisible();
  await photo.click();

  const viewer = window.getByRole("dialog", { name: "Media viewer" });
  await expect(viewer).toBeVisible();

  // Media order in the chat: photo, video, then the three album tiles.
  await window.keyboard.press("ArrowRight");
  await expect(viewer.locator("video")).toBeVisible();

  await window.keyboard.press("ArrowRight");
  await expect(viewer.locator("img")).toHaveAttribute(
    "src",
    /^telo-media:\/\/cache\/design_media-3\.png/,
  );

  await window.keyboard.press("ArrowLeft");
  await expect(viewer.locator("video")).toBeVisible();

  // The previous button is disabled at the start of the sequence.
  await window.keyboard.press("ArrowLeft");
  await expect(
    viewer.getByRole("button", { name: "Previous media" }),
  ).toBeDisabled();

  await viewer.getByRole("button", { name: "Close viewer" }).click();
  await expect(viewer).toHaveCount(0);
});

test("renders an album as one grid and opens the viewer at the clicked tile", async ({
  window,
}) => {
  const conversation = await openDesignChat(window);

  // The caption rides on the first tile only, and the three tiles share one
  // grid instead of stacking as separate cards. Tile preloads race three
  // downloads at once, so they get extra time under trace-recording runs.
  await expect(
    conversation.getByText("Reference shots for the viewer work."),
  ).toHaveCount(1);
  const tile = conversation.getByRole("button", { name: "telo-album-two.png" });
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect(
    conversation.getByRole("button", { name: "telo-album-one.png" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "telo-album-three.png" }),
  ).toBeVisible();

  await tile.click();
  const viewer = window.getByRole("dialog", { name: "Media viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute(
    "src",
    /^telo-media:\/\/cache\/design_media-4\.png/,
  );

  // The album position carries into the viewer's navigation.
  await viewer.getByRole("button", { name: "Previous media" }).click();
  await expect(viewer.locator("img")).toHaveAttribute(
    "src",
    /^telo-media:\/\/cache\/design_media-3\.png/,
  );

  await window.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
