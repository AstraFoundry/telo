import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

async function openAccountMenu(
  window: Parameters<typeof waitForDemoWorkspace>[0],
) {
  await window.getByRole("button", { name: "Open account menu" }).click();
}

test("exposes Telegram account actions from the avatar menu", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await openAccountMenu(window);

  for (const label of [
    "My Profile",
    "New Story",
    "New Group",
    "New Channel",
    "Start secret chat",
    "Contacts",
    "Calls",
    "Saved Messages",
    "Settings",
  ]) {
    await expect(
      window.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }

  await window.getByRole("button", { name: "My Profile" }).click();
  await expect(
    window
      .getByRole("complementary", { name: "Chat info" })
      .getByText("Demo User", { exact: true }),
  ).toBeVisible();
});

test("creates a group and channel from the avatar menu", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await openAccountMenu(window);
  await window.getByRole("button", { name: "New Group" }).click();
  const groupDialog = window.getByRole("dialog", { name: "New Group" });
  await groupDialog.getByLabel("Group name").fill("Launch Crew");
  // The picker lists contacts; Mina is the demo's one non-contact (the
  // add-to-contacts path), so the group is built from Aron.
  await groupDialog.getByRole("button", { name: "Aron @aron" }).click();
  await groupDialog.getByRole("button", { name: "Create group" }).click();
  await expect(
    window.getByRole("heading", { name: "Launch Crew" }),
  ).toBeVisible();

  await openAccountMenu(window);
  await window.getByRole("button", { name: "New Channel" }).click();
  await window.getByLabel("Channel name").fill("Release Notes");
  await window.getByLabel("Description").fill("Product updates");
  await window.getByRole("button", { name: "Create channel" }).click();
  await expect(
    window.getByRole("heading", { name: "Release Notes" }),
  ).toBeVisible();
});

test("opens calls and posts a photo story", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await openAccountMenu(window);
  await window.getByRole("button", { name: "Calls" }).click();
  await expect(window.getByRole("dialog", { name: "Calls" })).toContainText(
    "Incoming",
  );
  await window.getByRole("button", { name: "Close dialog" }).click();

  await openAccountMenu(window);
  await window.getByRole("button", { name: "New Story" }).click();
  await window.getByLabel("Story media").setInputFiles({
    name: "story.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await window.getByLabel("Caption").fill("From Telo");
  await window.getByRole("button", { name: "Post story" }).click();
  await expect(
    window.getByRole("button", { name: "Story posted" }),
  ).toBeVisible();
});
