import { describe, expect, it } from "vitest";

import {
  AgentTriggerRule,
  type AgentTriggerMatchInput,
} from "./agent-trigger-rule";

const NOW = "2026-09-03T10:00:00.000Z";

function rule(
  overrides: Partial<Parameters<typeof AgentTriggerRule.create>[0]> = {},
): AgentTriggerRule {
  return AgentTriggerRule.create({
    ruleId: "rule-1",
    name: "Boss pings",
    promptTemplate: "Draft a reply",
    createdBy: "user",
    now: NOW,
    match: { keywords: ["urgent"] },
    ...overrides,
  });
}

function message(
  overrides: Partial<AgentTriggerMatchInput> = {},
): AgentTriggerMatchInput {
  return {
    chatId: "chat-1",
    senderId: "user-1",
    body: "this is urgent, please look",
    outgoing: false,
    chatMuted: false,
    ...overrides,
  };
}

describe("AgentTriggerRule.create", () => {
  it("defaults to draft-only delivery and enabled", () => {
    const snapshot = rule().snapshot();
    expect(snapshot.delivery).toBe("draft-only");
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.match.excludeMuted).toBe(true);
  });

  it("rejects a rule with no match dimension", () => {
    expect(() => rule({ match: {} })).toThrow(/at least one match dimension/);
  });

  it("rejects an invalid regular expression", () => {
    expect(() => rule({ match: { pattern: "(" } })).toThrow(
      /not a valid regular expression/,
    );
  });

  it("rejects blank identity fields and template", () => {
    expect(() => rule({ ruleId: " " })).toThrow(/id is required/);
    expect(() => rule({ name: " " })).toThrow(/name is required/);
    expect(() => rule({ promptTemplate: " " })).toThrow(
      /prompt template is required/,
    );
  });

  it("drops blank entries from match lists", () => {
    const snapshot = rule({
      match: { chatIds: [" chat-1 ", ""], keywords: ["urgent"] },
    }).snapshot();
    expect(snapshot.match.chatIds).toEqual(["chat-1"]);
  });
});

describe("AgentTriggerRule.matches", () => {
  it("matches a keyword case-insensitively", () => {
    expect(rule().matches(message({ body: "URGENT meeting" }))).toBe(true);
    expect(rule().matches(message({ body: "whenever you can" }))).toBe(false);
  });

  it("combines dimensions with AND", () => {
    const strict = rule({
      match: { chatIds: ["chat-1"], keywords: ["urgent"] },
    });
    expect(strict.matches(message())).toBe(true);
    expect(strict.matches(message({ chatId: "chat-2" }))).toBe(false);
  });

  it("matches any keyword within the dimension", () => {
    const multi = rule({ match: { keywords: ["urgent", "asap"] } });
    expect(multi.matches(message({ body: "need this asap" }))).toBe(true);
  });

  it("matches the regular expression against the body", () => {
    const patterned = rule({ match: { pattern: "^code \\d{4}$" } });
    expect(patterned.matches(message({ body: "code 1234" }))).toBe(true);
    expect(patterned.matches(message({ body: "code abc" }))).toBe(false);
  });

  it("never matches outgoing messages, including its own automation sends", () => {
    expect(rule().matches(message({ outgoing: true }))).toBe(false);
  });

  it("skips muted chats by default and allows them when configured", () => {
    expect(rule().matches(message({ chatMuted: true }))).toBe(false);
    const loud = rule({ match: { keywords: ["urgent"], excludeMuted: false } });
    expect(loud.matches(message({ chatMuted: true }))).toBe(true);
  });

  it("never matches while disabled", () => {
    const disabled = rule().withEnabled(false, NOW);
    expect(disabled.matches(message())).toBe(false);
  });
});

describe("AgentTriggerRule persistence", () => {
  it("round-trips through snapshot and restore", () => {
    const original = rule({
      delivery: "auto-send",
      match: {
        chatIds: ["chat-1"],
        senderIds: ["user-9"],
        keywords: ["urgent"],
        pattern: "urgent\\s+\\w+",
        excludeMuted: false,
      },
    });
    const restored = AgentTriggerRule.restore(original.snapshot());
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(
      restored.matches(message({ senderId: "user-9", body: "urgent meeting" })),
    ).toBe(true);
  });
});
