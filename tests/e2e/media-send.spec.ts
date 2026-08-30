import { rm, writeFile } from "node:fs/promises";

import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// A 1x1 transparent PNG. The demo repository derives the media kind from the
// file's MIME type, and the tray preview needs a decodable image.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// The composer's file input is visually hidden and the native picker cannot
// be automated, so files are staged onto the input directly.
const FILE_INPUT = 'input[type="file"]';

test("shows the attachment tray after attaching a photo and clears it on remove", async ({
  window,
}, testInfo) => {
  await waitForDemoWorkspace(window);

  const filePath = testInfo.outputPath("photo.png");
  await writeFile(filePath, PNG_BYTES);

  await expect(
    window.getByRole("button", { name: "Attach photos, videos, or files" }),
  ).toBeVisible();
  await window.locator(FILE_INPUT).setInputFiles(filePath);

  const remove = window.getByRole("button", {
    name: "Remove attachment: photo.png",
  });
  await expect(remove).toBeVisible();

  await remove.click();
  await expect(
    window.getByRole("button", { name: /Remove attachment:/ }),
  ).toHaveCount(0);
});

test("sends a photo with a caption and shows the completed media bubble", async ({
  window,
}, testInfo) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const filePath = testInfo.outputPath("photo.png");
  await writeFile(filePath, PNG_BYTES);

  await window.locator(FILE_INPUT).setInputFiles(filePath);
  await expect(
    window.getByRole("button", { name: "Remove attachment: photo.png" }),
  ).toBeVisible();

  const caption = "Photo from the e2e media journey.";
  const composer = window.getByLabel("Write a message…");
  await composer.fill(caption);
  await composer.press("Enter");

  // Sent media is downloadable in the demo workspace: the thumbnail preloads
  // and the bubble renders the actual image, with the caption alongside.
  const photo = conversation.getByRole("button", { name: "photo.png" });
  await expect(photo).toBeVisible();
  await expect(photo.locator("img")).toHaveAttribute(
    "src",
    /^telo-media:\/\/cache\//,
  );
  await expect(conversation.getByText(caption)).toBeVisible();

  await expect(composer).toHaveValue("");
  await expect(
    window.getByRole("button", { name: /Remove attachment:/ }),
  ).toHaveCount(0);
});

test("sends multiple photos as one album with a single caption", async ({
  window,
}, testInfo) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const first = testInfo.outputPath("album-one.png");
  const second = testInfo.outputPath("album-two.png");
  await writeFile(first, PNG_BYTES);
  await writeFile(second, PNG_BYTES);

  await window.locator(FILE_INPUT).setInputFiles([first, second]);
  await expect(
    window.getByRole("button", { name: "Remove attachment: album-one.png" }),
  ).toBeVisible();
  await expect(
    window.getByRole("button", { name: "Remove attachment: album-two.png" }),
  ).toBeVisible();

  const caption = "Both photos in one album.";
  const composer = window.getByLabel("Write a message…");
  await composer.fill(caption);
  await composer.press("Enter");

  // The album lands as one grid of downloadable tiles; the caption rides on
  // the first item only.
  await expect(
    conversation.getByRole("button", { name: "album-one.png" }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "album-two.png" }),
  ).toBeVisible();
  await expect(conversation.getByText(caption)).toHaveCount(1);
});

test("keeps the attachment for retry when the upload fails", async ({
  window,
}, testInfo) => {
  await waitForDemoWorkspace(window);

  const conversation = window.getByRole("region", { name: "Conversation" });
  const filePath = testInfo.outputPath("retry-photo.png");
  await writeFile(filePath, PNG_BYTES);

  await window.locator(FILE_INPUT).setInputFiles(filePath);
  await expect(
    window.getByRole("button", { name: "Remove attachment: retry-photo.png" }),
  ).toBeVisible();

  // Removing the staged file makes the main-process validation reject the
  // upload — the only failure the demo workspace can surface.
  await rm(filePath);

  const caption = "This send fails once.";
  const composer = window.getByLabel("Write a message…");
  await composer.fill(caption);
  await composer.press("Enter");

  const alert = window.getByRole("alert");
  await expect(alert).toContainText("Attachments were not sent");
  // The staged attachment and the typed caption survive the failure, so the
  // send can be retried without re-attaching.
  await expect(
    window.getByRole("button", { name: "Remove attachment: retry-photo.png" }),
  ).toBeVisible();
  await expect(composer).toHaveValue(caption);
  await expect(
    conversation.getByRole("button", { name: "retry-photo.png" }),
  ).toHaveCount(0);

  await writeFile(filePath, PNG_BYTES);
  await composer.press("Enter");

  await expect(alert).toHaveCount(0);
  await expect(
    conversation.getByRole("button", { name: "retry-photo.png" }),
  ).toBeVisible();
  await expect(conversation.getByText(caption)).toBeVisible();
});
