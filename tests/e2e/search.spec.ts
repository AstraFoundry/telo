import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// The demo repository (backend/src/infrastructure/telegram/demo-telegram-repository.ts)
// answers global and in-chat searches over its deterministic fixtures, so
// these specs exercise the server-search path end to end: the debounced
// sidebar query, the message-result jump (select chat + page until found +
// highlight), match navigation, and the header presence/pin surface.

test("global search finds a message and jumps to it in its chat", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  // "retry flow" matches no chat title but one message body in Telo Design.
  await window.getByLabel("Search chats").fill("retry flow");

  const chats = window.getByRole("navigation", { name: "Chats" });
  const result = chats.getByRole("button", {
    name: /The retry flow needs a failed state/,
  });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Lev");

  await result.click();

  // The jump selects the chat, scrolls the match into view, and highlights it.
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();
  const match = window.locator("#conversation-message-design-4");
  await expect(match).toBeInViewport();
  await expect(match).toHaveAttribute("data-highlighted", "true");
});

test("in-chat search navigates matches and clears on Escape", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Telo Design/ })
    .click();

  await window.getByRole("button", { name: "Search in chat" }).click();
  const field = window.getByLabel("Search messages");
  await field.fill("the");

  // Seven design messages contain "the"; the newest match is current first.
  await expect(window.getByText("1 of 7")).toBeVisible();
  const newest = window.locator("#conversation-message-design-6");
  await expect(newest).toHaveAttribute("data-highlighted", "true");

  // Enter walks to older matches; Shift+Enter walks back.
  await field.press("Enter");
  await expect(window.getByText("2 of 7")).toBeVisible();
  const second = window.locator("#conversation-message-design-5");
  await expect(second).toHaveAttribute("data-highlighted", "true");
  await expect(newest).not.toHaveAttribute("data-highlighted", "true");

  await field.press("Shift+Enter");
  await expect(window.getByText("1 of 7")).toBeVisible();

  // The up/down buttons mirror the keyboard navigation.
  await window.getByRole("button", { name: "Older match" }).click();
  await expect(window.getByText("2 of 7")).toBeVisible();
  await window.getByRole("button", { name: "Newer match" }).click();
  await expect(window.getByText("1 of 7")).toBeVisible();

  // Escape closes the bar and clears the highlight.
  await field.press("Escape");
  await expect(window.getByLabel("Search messages")).toHaveCount(0);
  await expect(newest).not.toHaveAttribute("data-highlighted", "true");
});

test("the header shows avatar and presence and pins the chat", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);

  // Offsite Planning (archived) is the demo's online direct chat.
  await window.getByRole("tab", { name: /Archive/ }).click();
  await window
    .getByRole("navigation", { name: "Chats" })
    .getByRole("button", { name: /Offsite Planning/ })
    .click();

  const header = window.locator("main header");
  await expect(
    header.getByRole("heading", { name: "Offsite Planning" }),
  ).toBeVisible();
  // The header photo is a profile entry point, never letter initials.
  await expect(
    header.getByRole("button", { name: "Open profile" }),
  ).toBeVisible();
  await expect(header.getByText("online")).toBeVisible();

  // Pin toggles end-to-end: the demo backend persists the new state and the
  // header reflects it.
  const pin = header.getByRole("button", { name: "Pin" });
  await pin.click();
  const unpin = header.getByRole("button", { name: "Unpin" });
  await expect(unpin).toBeVisible();
  await expect(unpin).toHaveAttribute("aria-pressed", "true");

  await unpin.click();
  await expect(header.getByRole("button", { name: "Pin" })).toBeVisible();
});
