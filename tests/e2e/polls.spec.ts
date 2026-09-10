import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

/**
 * Poll tallies: a vote lands as an edited-message upsert and the card's
 * counters (percentages and totals) roll to the new values.
 */
test("voting in a quiz reveals the tally with rolling counters", async ({
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
  const quiz = conversation.locator("[id^='conversation-message-']", {
    hasText: "Which client reveals a quiz answer only after voting?",
  });
  await quiz.scrollIntoViewIfNeeded();

  await quiz.getByRole("radio", { name: /Telegram Desktop/ }).click();

  // The reveal swaps voting rows for results: percentages and the total.
  await expect(quiz.locator(".sr-only", { hasText: "100%" })).toHaveCount(1);
  // The footer's total counter reads exactly 1 (the only bare "1" sr-only).
  await expect(quiz.locator(".sr-only", { hasText: /^1$/ })).toHaveCount(1);
  await expect(quiz.getByText(/votes/)).toBeVisible();
});
