import type { Page } from "@playwright/test";

import { demoTest as test, expect, waitForDemoWorkspace } from "./fixtures";

// Same deterministic path as agent-summary.spec.ts: the demo gateway
// (TELO_DEMO_WORKSPACE=1) answers without a provider once any key is saved.
async function configureDemoAgentKey(window: Page) {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
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

test("previews the folder scope payload, runs with it, and logs an audit record", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await configureDemoAgentKey(window);

  await window.getByRole("button", { name: "Open agent" }).click();
  const panel = window.getByRole("complementary", { name: "Agent" });
  // "Selected" needs a reply target, which this flow never sets.
  await expect(panel.getByRole("button", { name: "Selected" })).toBeDisabled();

  // The All folder holds only Telo Design's three unread messages.
  await panel.getByRole("button", { name: "Folder" }).click();
  const previewTrigger = panel.getByRole("button", {
    name: "Payload preview",
  });
  await expect(previewTrigger).toContainText("3");
  await previewTrigger.click();

  // The disclosure lists exactly what the model will receive: sender, body,
  // and the message id of each scoped message.
  await expect(
    panel.getByText("The retry flow needs a failed state in the transcript."),
  ).toBeVisible();
  await expect(
    panel.getByText("And the unread divider has to survive paging."),
  ).toBeVisible();
  await expect(panel.getByText("Ship both with the next build.")).toBeVisible();
  await expect(panel.getByText("design-4", { exact: true })).toBeVisible();
  await expect(panel.getByText("design-6", { exact: true })).toBeVisible();

  const composer = window.getByLabel("Ask about this workspace…");
  await composer.fill("What did I miss?");
  await composer.press("Enter");

  const conversation = window.getByRole("region", {
    name: "Agent conversation",
  });
  await expect(conversation).toContainText("What did I miss?");
  // The demo gateway echoes the start of the assembled prompt: the scoped,
  // redacted payload block proves the context reached the model untouched.
  await expect(conversation).toContainText("Demo agent response:");
  await expect(conversation).toContainText("design-4");

  // The run appended a local audit record: scope and message count, no
  // prompt text.
  await panel.getByRole("button", { name: "Recent runs" }).click();
  await expect(panel.getByText(/Folder · 3/)).toBeVisible();
});

test("scopes the payload to the message being replied to", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await configureDemoAgentKey(window);

  const chats = window.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: /Telo Design/ }).click();

  // Reply to one message: until multi-select exists, the reply target is the
  // "Selected" scope. Scope to the conversation region: the agent panel's
  // payload preview can render the same message text.
  await window
    .getByRole("region", { name: "Conversation" })
    .getByText("And the unread divider has to survive paging.")
    .click({ button: "right" });
  await window
    .getByRole("menu")
    .getByRole("menuitem", { name: "Reply" })
    .click();

  await window.getByRole("button", { name: "Open agent" }).click();
  const panel = window.getByRole("complementary", { name: "Agent" });
  await panel.getByRole("button", { name: "Selected" }).click();

  const previewTrigger = panel.getByRole("button", {
    name: "Payload preview",
  });
  await expect(previewTrigger).toContainText("1");
  await previewTrigger.click();
  await expect(
    panel.getByText("And the unread divider has to survive paging."),
  ).toBeVisible();
  await expect(panel.getByText("design-5", { exact: true })).toBeVisible();
});
