import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  AgentAutomationEvent,
  AgentScheduledTaskDto,
  AgentTriggerRuleDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import type { TeloApiMock } from "shared/test/mock-telo";
import { installTeloApiMock } from "shared/test/mock-telo";

import { AgentAutomationSettings } from "./agent-automation-settings";

const RULE: AgentTriggerRuleDto = {
  ruleId: "rule-1",
  name: "Invoice watch",
  enabled: true,
  match: {
    chatIds: ["42"],
    senderIds: [],
    keywords: ["invoice", "receipt"],
    pattern: null,
    excludeMuted: true,
  },
  delivery: "draft-only",
  promptTemplate: "Summarize the invoice.",
  createdBy: "agent",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const TASK: AgentScheduledTaskDto = {
  taskId: "task-1",
  name: "Morning digest",
  enabled: false,
  schedule: { kind: "cron", expression: "0 9 * * 1" },
  delivery: "auto-send",
  promptTemplate: "Digest my unread chats.",
  chatId: "42",
  context: { scope: "unread" },
  lastRunAt: null,
  nextRunAt: "2026-09-04T09:00:00.000Z",
  createdBy: "user",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

/** A spent one-shot: nextRunAt is null and the row must not show a next run. */
const SPENT_TASK: AgentScheduledTaskDto = {
  ...TASK,
  taskId: "task-2",
  name: "One-off reminder",
  schedule: { kind: "once", runAt: "2026-08-20T09:00:00.000Z" },
  nextRunAt: null,
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function automationEvent(
  part: Partial<AgentAutomationEvent>,
): AgentAutomationEvent {
  return {
    type: "automation-run",
    source: "trigger",
    sourceId: RULE.ruleId,
    sourceName: RULE.name,
    chatId: "chat-9",
    delivery: "draft-only",
    status: "sent",
    preview: "Posted a reply.",
    ...part,
  };
}

describe("AgentAutomationSettings", () => {
  let telo: TeloApiMock;
  let automationListener: ((event: AgentAutomationEvent) => void) | null;
  let automationUnsubscribed: boolean;

  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    telo = installTeloApiMock();
    telo.agent.listTriggerRules.mockResolvedValue([RULE]);
    telo.agent.listScheduledTasks.mockResolvedValue([TASK, SPENT_TASK]);
    automationListener = null;
    automationUnsubscribed = false;
    telo.agent.onAutomationEvent.mockImplementation((listener) => {
      automationListener = listener;
      return () => {
        automationUnsubscribed = true;
        automationListener = null;
      };
    });
  });

  async function renderSettings() {
    const view = render(<AgentAutomationSettings />);
    await screen.findByText(RULE.name);
    await screen.findByText(TASK.name);
    return view;
  }

  it("renders rules and tasks from the bridge with badges and summaries", async () => {
    await renderSettings();

    // Rule: name, delivery badge, agent-authored marker, match summary.
    expect(screen.getByText(copy.deliveryDraftOnlyBadge)).toBeTruthy();
    expect(screen.getByRole("img", { name: copy.createdByAgent })).toBeTruthy();
    expect(screen.getByText(/invoice, receipt/)).toBeTruthy();
    expect(screen.getByText(new RegExp(copy.matchSkipsMuted))).toBeTruthy();

    // Task: cron expression and the formatted next run in one summary line.
    // Both task fixtures deliver auto-send, so the badge appears twice.
    expect(screen.getAllByText(copy.deliveryAutoSendBadge)).toHaveLength(2);
    expect(
      screen.getByText(new RegExp(`0 9 \\* \\* 1 · ${copy.nextRun}`)),
    ).toBeTruthy();
    expect(
      screen.getByText(new RegExp(formatDateTime(TASK.nextRunAt ?? ""))),
    ).toBeTruthy();
  });

  it("never shows a next run for a task whose nextRunAt is null", async () => {
    await renderSettings();

    expect(screen.getByText(SPENT_TASK.name)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(copy.nextRun))).toHaveLength(1);
  });

  it("toggles a rule through the bridge with the flipped value", async () => {
    const user = userEvent.setup();
    telo.agent.setTriggerRuleEnabled.mockResolvedValue({
      ...RULE,
      enabled: false,
    });
    await renderSettings();

    await user.click(
      screen.getByRole("switch", {
        name: `${copy.toggleTriggerRule}: ${RULE.name}`,
      }),
    );

    expect(telo.agent.setTriggerRuleEnabled).toHaveBeenCalledWith(
      RULE.ruleId,
      false,
    );
  });

  it("toggles a task through the bridge with the flipped value", async () => {
    const user = userEvent.setup();
    telo.agent.setScheduledTaskEnabled.mockResolvedValue({
      ...TASK,
      enabled: true,
    });
    await renderSettings();

    await user.click(
      screen.getByRole("switch", {
        name: `${copy.toggleScheduledTask}: ${TASK.name}`,
      }),
    );

    expect(telo.agent.setScheduledTaskEnabled).toHaveBeenCalledWith(
      TASK.taskId,
      true,
    );
  });

  it("deletes a rule through the bridge and removes its row", async () => {
    const user = userEvent.setup();
    telo.agent.removeTriggerRule.mockResolvedValue(undefined);
    await renderSettings();

    await user.click(
      screen.getByRole("button", {
        name: `${copy.deleteTriggerRule}: ${RULE.name}`,
      }),
    );

    expect(telo.agent.removeTriggerRule).toHaveBeenCalledWith(RULE.ruleId);
    await waitFor(() => {
      expect(screen.queryByText(RULE.name)).toBeNull();
    });
  });

  it("creates a rule with the draft-only default and parsed match dimensions", async () => {
    const user = userEvent.setup();
    telo.agent.saveTriggerRule.mockResolvedValue(RULE);
    await renderSettings();

    await user.click(screen.getByRole("button", { name: copy.addTriggerRule }));
    const dialog = await screen.findByRole("dialog", {
      name: copy.addTriggerRule,
    });
    expect(dialog).toBeTruthy();

    await user.type(screen.getByLabelText(copy.ruleName), "Keyword alert");
    await user.type(
      screen.getByLabelText(copy.matchKeywords),
      "alpha, beta ,,",
    );
    await user.type(screen.getByLabelText(copy.promptTemplate), "Brief me.");
    await user.click(
      screen.getByRole("button", { name: copy.saveTriggerRule }),
    );

    await waitFor(() => {
      expect(telo.agent.saveTriggerRule).toHaveBeenCalledWith({
        name: "Keyword alert",
        match: { keywords: ["alpha", "beta"], excludeMuted: false },
        delivery: "draft-only",
        promptTemplate: "Brief me.",
      });
    });
  });

  it("sends auto-send only after the radio is explicitly selected", async () => {
    const user = userEvent.setup();
    telo.agent.saveTriggerRule.mockResolvedValue(RULE);
    await renderSettings();

    await user.click(screen.getByRole("button", { name: copy.addTriggerRule }));
    await screen.findByRole("dialog", { name: copy.addTriggerRule });
    await user.type(screen.getByLabelText(copy.ruleName), "Urgent mail");
    await user.type(screen.getByLabelText(copy.matchKeywords), "urgent");
    await user.type(screen.getByLabelText(copy.promptTemplate), "Alert me.");
    await user.click(
      screen.getByRole("radio", { name: copy.deliveryAutoSend }),
    );
    await user.click(
      screen.getByRole("button", { name: copy.saveTriggerRule }),
    );

    await waitFor(() => {
      expect(telo.agent.saveTriggerRule).toHaveBeenCalledWith(
        expect.objectContaining({ delivery: "auto-send" }),
      );
    });
  });

  it("rejects an invalid regex client-side without calling the bridge", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(screen.getByRole("button", { name: copy.addTriggerRule }));
    await screen.findByRole("dialog", { name: copy.addTriggerRule });
    await user.type(screen.getByLabelText(copy.ruleName), "Pattern rule");
    // "[[" is the user-event escape that types a literal "[".
    await user.type(screen.getByLabelText(copy.matchPattern), "[[unclosed");
    await user.type(screen.getByLabelText(copy.promptTemplate), "Brief me.");
    await user.click(
      screen.getByRole("button", { name: copy.saveTriggerRule }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      copy.invalidPattern,
    );
    expect(telo.agent.saveTriggerRule).not.toHaveBeenCalled();
  });

  it("surfaces a backend cron rejection inline", async () => {
    const user = userEvent.setup();
    telo.agent.saveScheduledTask.mockRejectedValue(
      new Error("Invalid cron expression"),
    );
    await renderSettings();

    await user.click(
      screen.getByRole("button", { name: copy.addScheduledTask }),
    );
    await screen.findByRole("dialog", { name: copy.addScheduledTask });
    await user.type(screen.getByLabelText(copy.taskName), "Digest");
    await user.type(screen.getByLabelText(copy.cronExpression), "61 * * * *");
    await user.type(screen.getByLabelText(copy.targetChatId), "42");
    await user.type(screen.getByLabelText(copy.promptTemplate), "Digest.");
    await user.click(
      screen.getByRole("button", { name: copy.saveScheduledTask }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Invalid cron expression",
    );
    // The dialog stays open so the entry is not lost.
    expect(
      screen.getByRole("dialog", { name: copy.addScheduledTask }),
    ).toBeTruthy();
  });

  it("rejects a cron expression without five fields client-side", async () => {
    const user = userEvent.setup();
    await renderSettings();

    await user.click(
      screen.getByRole("button", { name: copy.addScheduledTask }),
    );
    await screen.findByRole("dialog", { name: copy.addScheduledTask });
    await user.type(screen.getByLabelText(copy.taskName), "Digest");
    await user.type(screen.getByLabelText(copy.cronExpression), "0 9");
    await user.type(screen.getByLabelText(copy.targetChatId), "42");
    await user.type(screen.getByLabelText(copy.promptTemplate), "Digest.");
    await user.click(
      screen.getByRole("button", { name: copy.saveScheduledTask }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      copy.cronFieldsInvalid,
    );
    expect(telo.agent.saveScheduledTask).not.toHaveBeenCalled();
  });

  it("refreshes both lists when an automation event arrives", async () => {
    await renderSettings();
    expect(automationListener).toBeTruthy();
    expect(telo.agent.listTriggerRules).toHaveBeenCalledTimes(1);

    const added: AgentTriggerRuleDto = {
      ...RULE,
      ruleId: "rule-2",
      name: "New rule",
    };
    telo.agent.listTriggerRules.mockResolvedValue([RULE, added]);
    automationListener?.(automationEvent({ status: "sent" }));

    await screen.findByText(added.name);
    expect(telo.agent.listTriggerRules).toHaveBeenCalledTimes(2);
    expect(telo.agent.listScheduledTasks).toHaveBeenCalledTimes(2);
    // A successful delivery already shows in the chat; it stays quiet here.
    expect(telo.shell.notify).not.toHaveBeenCalled();
  });

  it("notifies with the chat id tag on a draft conflict", async () => {
    await renderSettings();

    automationListener?.(
      automationEvent({
        status: "draft-conflict",
        preview: "The composer already has a draft.",
      }),
    );

    await waitFor(() => {
      expect(telo.shell.notify).toHaveBeenCalledWith(
        RULE.name,
        "The composer already has a draft.",
        "chat-9",
      );
    });
  });

  it("notifies with the error message on a failed run", async () => {
    await renderSettings();

    automationListener?.(
      automationEvent({ status: "error", error: "Provider timed out" }),
    );

    await waitFor(() => {
      expect(telo.shell.notify).toHaveBeenCalledWith(
        RULE.name,
        "Provider timed out",
        "chat-9",
      );
    });
  });

  it("unsubscribes from automation events on unmount", async () => {
    const view = await renderSettings();

    view.unmount();

    expect(automationUnsubscribed).toBe(true);
  });
});
