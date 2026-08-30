import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

test("opens the chat profile with shared media, pinned messages, and a back stack", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();

  await window.getByRole("button", { name: "Chat info" }).click();
  const profile = window.getByRole("complementary", { name: "Chat info" });
  await expect(profile.getByText("Telo Design")).toBeVisible();
  await expect(profile.getByText("Group")).toBeVisible();

  // The shared media grid shows the chat's photo and video fixtures.
  await expect(
    profile.getByRole("button", { name: /Shared media/ }),
  ).toBeVisible();
  await expect(
    profile.getByRole("button", { name: "telo-hero.png" }),
  ).toBeVisible();

  // Section views push onto the panel's back stack; Back returns to the
  // profile's main view.
  await profile.getByRole("button", { name: /Pinned messages/ }).click();
  await expect(
    profile.getByRole("heading", { name: "Pinned messages" }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "Back" }).click();
  await expect(
    profile.getByRole("heading", { name: "Chat info" }),
  ).toBeVisible();

  // Clicking a pinned message jumps to it in the transcript and highlights it.
  await profile
    .getByRole("button", { name: /Ship both with the next build/ })
    .click();
  const conversation = window.getByRole("region", { name: "Conversation" });
  await expect(conversation.locator('[data-highlighted="true"]')).toContainText(
    "Ship both with the next build.",
  );
});
