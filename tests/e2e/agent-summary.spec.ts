import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// The demo gateway (TELO_DEMO_WORKSPACE=1) answers chat actions
// deterministically: "Demo summary of N messages." plus one citation marker
// per message id in the assembled unread scope. The Telo Design demo chat
// has three unread text messages past its read boundary.
async function configureDemoAgentKey(window: import("@playwright/test").Page) {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  // Settings opens on Account; the Agent pane is one step down the rail.
  await window.getByRole("button", { name: "Agent settings" }).click();
  await expect(
    window.getByRole("heading", { name: "Agent settings" }),
  ).toBeVisible();
  // The form backfills asynchronously once the stored configuration loads.
  await expect(window.getByLabel("Instructions")).toHaveValue(
    "Answer from the visible Telegram workspace. Ask before acting outside it.",
  );
  await window.getByLabel("API key").fill("sk-telo-e2e-demo-key");
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    window.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Back to conversation" }).click();
}

test("summarizes the unread messages and jumps to a citation", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await configureDemoAgentKey(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();
  await expect(
    window.getByRole("heading", { name: "Telo Design" }),
  ).toBeVisible();

  await window.getByRole("button", { name: "Open agent" }).click();
  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });

  await window.getByRole("button", { name: "Summarize unread" }).click();

  // The demo gateway streams the deterministic summary: the transcript shows
  // the action label as the user message and the streamed reply with the
  // citation markers stripped into numbered chips.
  await expect(conversation).toContainText("Summarize unread");
  await expect(conversation).toContainText("Demo summary of 3 messages.");
  await expect(conversation).not.toContainText("[[telo-cite:");
  await expect(
    conversation.getByRole("button", { name: "Scroll to message 1" }),
  ).toBeVisible();

  await conversation
    .getByRole("button", { name: "Scroll to message 1" })
    .click();

  // The first citation of the demo summary is design-4, the first unread
  // message past the read boundary; the jump scrolls it into view.
  await expect(window.locator("#conversation-message-design-4")).toBeVisible();
});

test("extracts decisions and todos with the same citation jump", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await configureDemoAgentKey(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();
  await window.getByRole("button", { name: "Open agent" }).click();
  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });

  await window
    .getByRole("button", { name: "Extract decisions & todos" })
    .click();

  await expect(conversation).toContainText("Extract decisions & todos");
  await expect(conversation).toContainText("Demo summary of 3 messages.");

  await conversation
    .getByRole("button", { name: "Scroll to message 2" })
    .click();
  await expect(window.locator("#conversation-message-design-5")).toBeVisible();
});
