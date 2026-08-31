import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// The demo repository (backend/src/infrastructure/telegram/demo-telegram-repository.ts)
// schedules a simulated typing pulse ~500ms after an outgoing send into a
// chat with a configured auto-reply, followed by the reply itself ~1400ms
// later. These specs exercise the Wave 1 sync spine end to end: optimistic
// delivery, the typing indicator, drafts surviving a chat switch, and
// reply-quote jump-to-message.

test("shows the recipient typing, then the auto-reply lands and the indicator clears", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  const conversation = window.getByRole("region", { name: "Conversation" });
  const composer = window.getByLabel("Write a message…");
  const body = "Kicking off the sync spine journey.";
  await composer.fill(body);
  await composer.press("Enter");

  // Optimistic send: the bubble and the cleared composer appear immediately,
  // without waiting for the IPC round trip.
  await expect(conversation).toContainText(body);
  await expect(composer).toHaveValue("");

  await expect(window.getByText("Typing…").first()).toBeVisible({
    timeout: 2_000,
  });
  await expect(conversation).toContainText("Looks good — shipping it.", {
    timeout: 3_000,
  });
  await expect(window.getByText("Typing…")).toHaveCount(0);
});

test("keeps a chat's draft when switching away and back", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();

  const composer = window.getByLabel("Write a message…");
  const draft = "Half-typed thought I do not want to lose.";
  await composer.fill(draft);

  await chats.getByRole("button", { name: /Product Notes/ }).click();
  await expect(composer).toHaveValue("");

  await chats.getByRole("button", { name: /Telo Design/ }).click();
  await expect(composer).toHaveValue(draft);
});

test("renders the unread divider before the first unread message", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();

  // The demo repository pins the design chat's read boundary at "design-3",
  // so the divider lands before the first of the three unread messages.
  const conversation = window.getByRole("region", { name: "Conversation" });
  const divider = conversation.getByText("Unread messages");
  const firstUnread = conversation.getByText(
    "The retry flow needs a failed state in the transcript.",
  );
  await expect(divider).toBeVisible();
  await expect(firstUnread).toBeVisible();

  const dividerBox = await divider.boundingBox();
  const firstUnreadBox = await firstUnread.boundingBox();
  expect(dividerBox!.y).toBeLessThan(firstUnreadBox!.y);

  // A fully read chat shows no divider.
  await chats.getByRole("button", { name: /Saved Messages/ }).click();
  await expect(conversation.getByText("Unread messages")).toHaveCount(0);
});

test("clicking a reply quote scrolls the source message back into view", async ({
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

  const composer = window.getByLabel("Write a message…");
  await composer.fill("Replying before we bury it under filler.");
  await composer.press("Enter");

  // Push the reply — and the quoted original above it — far off the top of
  // the transcript so the jump has to actually scroll.
  for (let index = 0; index < 25; index += 1) {
    await composer.fill(`Filler message ${index}`);
    await composer.press("Enter");
  }

  await conversation.hover();
  await window.mouse.wheel(0, 100_000);
  await expect(conversation.getByText("Filler message 24")).toBeInViewport();

  const originalMessage = conversation.getByText(quoted).first();
  await expect(originalMessage).not.toBeInViewport();

  await window
    .getByRole("button", { name: "Jump to original message" })
    .click();

  await expect(originalMessage).toBeInViewport();
});
