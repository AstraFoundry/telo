import type { Page } from "@playwright/test";

import {
  demoTest as test,
  expect,
  waitForDemoWorkspace,
  openAgentSettings,
  connectDemoAgentAccount,
} from "./fixtures";

// Demo workspace contracts these specs lean on:
// - The Telo Design chat's counterpart auto-replies "Looks good — shipping
//   it." after any non-silent send (DemoTelegramRepository; ~1.4s in an
//   interactive demo session, ~3s under TELO_E2E=1), so a rule
//   on the keyword "shipping" fires exactly once per counterpart reply.
// - The demo agent gateway answers every automation run with
//   "Demo agent response: <prompt start>", so drafts and sends are asserted
//   against that deterministic prefix.
// - Outgoing messages never trigger rules (the anti-loop boundary), but an
//   auto-send automation message is itself a non-silent send, so the
//   counterpart replies again on the same delay: the auto-send spec disables
//   the rule inside that window and proves the chain stopped at one hop.

const DESIGN_REPLY = "Looks good — shipping it.";
const DEMO_RESPONSE = /Demo agent response:/;

function chatsNav(window: Page) {
  return window.getByRole("navigation", { name: "Chats" });
}

function designRow(window: Page) {
  return chatsNav(window).getByRole("button", { name: /Telo Design/ });
}

function transcript(window: Page) {
  return window.getByRole("region", { name: "Conversation" });
}

function composer(window: Page) {
  return window.getByLabel("Write a message…");
}

/** Avatar menu -> Settings -> Agent settings, without the fixture's waits. */
async function navigateToAgentSettings(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Open account menu" }).click();
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("button", { name: "Agent settings" }).click();
}

interface RuleForm {
  readonly name: string;
  readonly keywords: string;
  readonly prompt: string;
  readonly delivery?: "auto-send";
}

/** Creates a trigger rule through the dialog; the agent pane must be open. */
async function createTriggerRule(window: Page, form: RuleForm): Promise<void> {
  await window.getByRole("button", { name: "Add rule" }).click();
  const dialog = window.getByRole("dialog", { name: "Add rule" });
  // The modal auto-focuses its first field on the next animation frame;
  // filling before that focus lands sends keystrokes to the wrong control.
  await expect(dialog.getByLabel("Rule name")).toBeFocused();
  await dialog.getByLabel("Rule name").fill(form.name);
  await dialog.getByLabel("Keywords").fill(form.keywords);
  if (form.delivery === "auto-send") {
    await dialog
      .getByRole("radio", { name: "Send replies automatically" })
      .click();
  }
  await dialog.getByLabel("Prompt").fill(form.prompt);
  await dialog.getByRole("button", { name: "Save rule" }).click();
  // The row's switch doubles as the save-completed signal: writes are not
  // optimistic, so it only renders once the main process persisted the rule.
  await expect(
    window.getByRole("switch", { name: `Toggle rule: ${form.name}` }),
  ).toBeVisible();
}

test("manages trigger rules from the agent settings", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await openAgentSettings(window);

  await expect(
    window.getByRole("heading", { name: "Trigger rules" }),
  ).toBeVisible();
  await expect(window.getByText(/No trigger rules yet/)).toBeVisible();
  await expect(
    window.getByRole("heading", { name: "Scheduled tasks" }),
  ).toBeVisible();
  await expect(window.getByText(/No scheduled tasks yet/)).toBeVisible();

  await window.getByRole("button", { name: "Add rule" }).click();
  const dialog = window.getByRole("dialog", { name: "Add rule" });
  await expect(dialog.getByLabel("Rule name")).toBeFocused();
  await dialog.getByLabel("Rule name").fill("Watch shipping updates");
  await dialog.getByLabel("Keywords").fill("shipping");
  // Draft-only is the preselected delivery; it never ships implied.
  await expect(
    dialog.getByRole("radio", { name: "Park replies as drafts" }),
  ).toHaveAttribute("aria-checked", "true");
  await dialog.getByLabel("Prompt").fill("Acknowledge the shipping update");
  await dialog.getByRole("button", { name: "Save rule" }).click();

  const toggle = window.getByRole("switch", {
    name: "Toggle rule: Watch shipping updates",
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(window.getByText("Draft", { exact: true })).toBeVisible();
  await expect(window.getByText("Keywords: shipping")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await window
    .getByRole("button", { name: "Delete rule: Watch shipping updates" })
    .click();
  await expect(toggle).toHaveCount(0);
  await expect(window.getByText(/No trigger rules yet/)).toBeVisible();
});

test("parks a matched reply as a composer draft", async ({ window }) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

  await openAgentSettings(window);
  await createTriggerRule(window, {
    name: "Draft shipping acknowledgement",
    keywords: "shipping",
    prompt: "Acknowledge the shipping update",
  });
  await window.getByRole("button", { name: "Back to conversation" }).click();

  await designRow(window).click();
  await composer(window).fill("Ship the automation build.");
  await composer(window).press("Enter");
  // The composer of the active chat is authoritative, so a remote draft
  // never clobbers it: the counterpart's reply (due in ~3s under TELO_E2E) and the rule's
  // draft must land while another chat is active for the draft to seed the
  // composer when Telo Design is reopened.
  await chatsNav(window)
    .getByRole("button", { name: /Saved Messages/ })
    .click();

  // The rule fired on the counterpart's reply and parked its run as a draft.
  await expect(designRow(window)).toContainText("Demo agent response:", {
    timeout: 10_000,
  });

  await designRow(window).click();
  await expect(composer(window)).toHaveValue(DEMO_RESPONSE);
  // Draft-only delivery: the transcript gained the counterpart's reply but
  // no outgoing automation message.
  await expect(transcript(window)).toContainText(DESIGN_REPLY);
  await expect(transcript(window).getByText(DEMO_RESPONSE)).toHaveCount(0);
});

test("auto-sends one reply, then stops once the rule is disabled", async ({
  window,
}) => {
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

  await openAgentSettings(window);
  await createTriggerRule(window, {
    name: "Auto-send shipping acknowledgement",
    keywords: "shipping",
    prompt: "Acknowledge the shipping update",
    delivery: "auto-send",
  });
  await window.getByRole("button", { name: "Back to conversation" }).click();

  await designRow(window).click();
  await composer(window).fill("Ship the automation build.");
  await composer(window).press("Enter");

  // The counterpart's reply is the rule's trigger. The automation's own send
  // re-arms the counterpart one reply-delay later (~3s under TELO_E2E), so the rule must be disabled
  // inside that window; the round trip through settings fits comfortably.
  await expect(
    transcript(window).getByText(DESIGN_REPLY).first(), // the quote in the automation bubble matches too
  ).toBeVisible();

  await navigateToAgentSettings(window);
  const toggle = window.getByRole("switch", {
    name: "Toggle rule: Auto-send shipping acknowledgement",
  });
  await toggle.click();
  // aria-checked only flips after the main process persisted the write, so
  // from here the trigger engine is guaranteed to skip the rule.
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await window.getByRole("button", { name: "Back to conversation" }).click();

  // The single automation send sits in the transcript as a reply quoting the
  // counterpart's message.
  const conversation = transcript(window);
  await expect(conversation.getByText(DEMO_RESPONSE)).toHaveCount(1);
  await expect(
    conversation.getByLabel("Jump to original message"),
  ).toContainText(DESIGN_REPLY);

  // The counterpart answered the automation's send (second incoming reply:
  // reply #1, the quote inside the automation bubble, reply #2), and the
  // disabled rule let it pass without a second hop.
  await expect(
    conversation.getByText(DESIGN_REPLY, { exact: true }),
  ).toHaveCount(3, { timeout: 10_000 });
  await expect(conversation.getByText(DEMO_RESPONSE)).toHaveCount(1);
});

test("runs a one-shot scheduled task into a chat draft", async ({ window }) => {
  // A datetime-local field has minute precision, so the soonest schedulable
  // fire is the next minute boundary — up to ~75s away.
  test.setTimeout(120_000);
  await waitForDemoWorkspace(window);
  await connectDemoAgentAccount(window);

  await openAgentSettings(window);
  await window.getByRole("button", { name: "Add task" }).click();
  const dialog = window.getByRole("dialog", { name: "Add task" });
  await expect(dialog.getByLabel("Task name")).toBeFocused();
  await dialog.getByLabel("Task name").fill("Shipping digest");
  await dialog.getByRole("radio", { name: "One time" }).click();
  // Next minute boundary; if it is less than 15s away, take the one after so
  // the dialog round trip cannot race the fire instant. (Even if it did, the
  // scheduler fires missed one-shots on save.)
  const fireAt = new Date();
  fireAt.setSeconds(0, 0);
  fireAt.setMinutes(fireAt.getMinutes() + 1);
  if (fireAt.getTime() - Date.now() < 15_000) {
    fireAt.setMinutes(fireAt.getMinutes() + 1);
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  const runAt =
    `${fireAt.getFullYear()}-${pad(fireAt.getMonth() + 1)}-${pad(fireAt.getDate())}` +
    `T${pad(fireAt.getHours())}:${pad(fireAt.getMinutes())}`;
  await dialog.getByLabel("Run at").fill(runAt);
  // Draft-only delivery is the preselected mode.
  await dialog.getByLabel("Target chat ID").fill("design");
  await dialog.getByLabel("Prompt").fill("Digest the shipping updates");
  await dialog.getByRole("button", { name: "Save task" }).click();
  await expect(
    window.getByRole("switch", { name: "Toggle task: Shipping digest" }),
  ).toBeVisible();
  await window.getByRole("button", { name: "Back to conversation" }).click();

  // Saved Messages stays the active chat so the incoming draft seeds Telo
  // Design's composer instead of being swallowed by it.
  await chatsNav(window)
    .getByRole("button", { name: /Saved Messages/ })
    .click();

  await expect(designRow(window)).toContainText("Demo agent response:", {
    timeout: 100_000,
  });
  await designRow(window).click();
  await expect(composer(window)).toHaveValue(DEMO_RESPONSE);
});
