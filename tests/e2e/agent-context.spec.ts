import {
  demoTest as test,
  expect,
  waitForDemoWorkspace,
  connectDemoAgentAccount,
} from "./fixtures";

// Same deterministic path as agent-summary.spec.ts: the demo gateway
// (TELO_DEMO_WORKSPACE=1) answers without a provider once an account is connected.

test("scopes a free prompt to the open chat's unread tail without a picker", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();
  await window.getByRole("button", { name: "Open agent" }).click();
  const panel = window.getByRole("complementary", { name: "Agent" });
  // The panel carries no scope picker, payload preview, or audit list; the
  // run's scope follows the workspace.
  await expect(panel.getByText("Context scope")).toHaveCount(0);
  await expect(panel.getByText("Payload preview")).toHaveCount(0);
  await expect(panel.getByText("Recent runs")).toHaveCount(0);

  const composer = window.getByLabel("Ask about this workspace…");
  await composer.fill("What did I miss?");
  await composer.press("Enter");

  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });
  await expect(conversation).toContainText("What did I miss?");
  // The demo gateway echoes the start of the assembled prompt: the scoped,
  // redacted payload block proves the chat's unread messages reached the
  // model untouched, starting with the first unread message's link, which
  // the panel renders as a citation mark.
  await expect(conversation).toContainText("Demo agent response:");
  await expect(
    conversation.getByRole("link", { name: "Scroll to message 1" }),
  ).toHaveAttribute("href", "telo://message/design/design-4");
});

test("adds selected messages to the agent as cards and scopes the run to them", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();
  const transcript = window.getByRole("region", { name: "Conversation" });
  const second = "And the unread divider has to survive paging.";
  await expect(transcript).toContainText(second);

  // Select one message from the context menu, then hand the selection to the
  // agent from the batch action bar.
  await transcript.getByText(second).click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Select" })
    .click();
  const bar = window.getByRole("region", { name: "Selection actions" });
  await expect(bar).toContainText("1 selected");
  await bar.getByRole("button", { name: "Add to Agent" }).click();

  // The panel opens with the message as a card inside the composer, and
  // selection mode ends.
  const panel = window.getByRole("complementary", { name: "Agent" });
  const cards = panel.getByRole("list", {
    name: "Messages added to the conversation",
  });
  await expect(cards).toContainText(second);
  await expect(bar).toHaveCount(0);

  const composer = window.getByLabel("Ask about this workspace…");
  await composer.fill("Summarize these");
  await composer.press("Enter");

  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });
  // Only the selected message travelled: design-5 is in the echoed payload,
  // its unread neighbours are not.
  await expect(conversation).toContainText("Demo agent response:");
  await expect(
    conversation.getByRole("link", { name: "Scroll to message 1" }),
  ).toHaveAttribute("href", "telo://message/design/design-5");
  await expect(conversation.getByRole("link")).toHaveCount(1);
  // The cards were consumed by the run.
  await expect(cards).toHaveCount(0);
});
