import {
  demoTest as test,
  expect,
  waitForDemoWorkspace,
  connectDemoAgentAccount,
} from "./fixtures";

// The demo gateway (TELO_DEMO_WORKSPACE=1) answers chat actions
// deterministically: "Demo summary of N messages." plus one cited point per
// message in the assembled unread scope, each naming its author with @ and
// ending in the message's in-app link. The Telo Design demo chat has three
// unread text messages past its read boundary.

test("summarizes the unread messages and jumps to a citation", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

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

  // The transcript shows the action label as the user message and the
  // streamed reply with the links rendered as numbered marks and the authors
  // as mention chips.
  await expect(conversation).toContainText("Summarize unread");
  await expect(conversation).toContainText("Demo summary of 3 messages.");
  await expect(conversation).not.toContainText("telo://");
  const first = conversation.getByRole("link", { name: "Scroll to message 1" });
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute("href", /^telo:\/\/message\//);

  // The demo reply follows up with pills once the run has settled.
  await expect(
    window.getByRole("list", { name: "Suggested prompts" }),
  ).toContainText("What should I reply?");

  await first.click();

  // The first citation of the demo summary is design-4, the first unread
  // message past the read boundary; the jump scrolls it into view.
  await expect(window.locator("#conversation-message-design-4")).toBeVisible();
});

test("extracts decisions and todos with the same citation jump", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

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

  await conversation.getByRole("link", { name: "Scroll to message 2" }).click();
  await expect(window.locator("#conversation-message-design-5")).toBeVisible();
});
