import { describe, expect, it } from "vitest";

import type { AgentScopedMessage } from "./agent-context";
import {
  REDACTED_EMAIL,
  REDACTED_PHONE,
  REDACTED_TOKEN,
  redactAgentContext,
  redactAgentText,
  sumRedactionCounts,
} from "./agent-redaction";

describe("redactAgentText", () => {
  it("masks email addresses", () => {
    expect(
      redactAgentText("Reach mina@example.com or a.b+tag@sub.domain.org"),
    ).toEqual({
      text: `Reach ${REDACTED_EMAIL} or ${REDACTED_EMAIL}`,
      counts: { emails: 2, phones: 0, tokens: 0 },
    });
  });

  it("masks international and local phone numbers", () => {
    expect(
      redactAgentText("Call +1 415 555 2671 or 0415 555 2671 tomorrow"),
    ).toEqual({
      text: `Call ${REDACTED_PHONE} or ${REDACTED_PHONE} tomorrow`,
      counts: { emails: 0, phones: 2, tokens: 0 },
    });
  });

  it("masks API-key-like tokens before they can be half-eaten", () => {
    expect(
      redactAgentText(
        "keys: sk-1234567890abcdefgh, sk_live_abcdefgh123, ghp_0123456789abcdef01, AIza0123456789abcdefghijklm",
      ),
    ).toEqual({
      text: `keys: ${REDACTED_TOKEN}, ${REDACTED_TOKEN}, ${REDACTED_TOKEN}, ${REDACTED_TOKEN}`,
      counts: { emails: 0, phones: 0, tokens: 4 },
    });
  });

  it("leaves dates, timestamps, and short digit runs intact", () => {
    const text = "Ship 2026-08-27 at 14:32, ticket 1234567, build 98765.";
    expect(redactAgentText(text)).toEqual({
      text,
      counts: { emails: 0, phones: 0, tokens: 0 },
    });
  });

  it("leaves plain prose intact", () => {
    const text = "The retry flow needs a failed state in the transcript.";
    expect(redactAgentText(text)).toEqual({
      text,
      counts: { emails: 0, phones: 0, tokens: 0 },
    });
  });
});

describe("redactAgentContext", () => {
  it("redacts sender names and bodies and aggregates counts", () => {
    const messages: ReadonlyArray<AgentScopedMessage> = [
      {
        messageId: "m1",
        chatId: "chat",
        chatTitle: "Telo Design",
        senderName: "+49 151 23456789",
        body: "Mail me at lev@example.com",
        sentAt: "2026-08-27T14:28:00.000Z",
      },
      {
        messageId: "m2",
        chatId: "chat",
        chatTitle: "Telo Design",
        senderName: "Mina",
        body: "No secrets here.",
        sentAt: "2026-08-27T14:30:00.000Z",
      },
    ];

    const { messages: redacted, counts } = redactAgentContext(messages);

    expect(redacted[0]).toMatchObject({
      senderName: REDACTED_PHONE,
      body: `Mail me at ${REDACTED_EMAIL}`,
    });
    expect(redacted[1]).toMatchObject({
      senderName: "Mina",
      body: "No secrets here.",
    });
    expect(counts).toEqual({ emails: 1, phones: 1, tokens: 0 });
  });
});

describe("sumRedactionCounts", () => {
  it("adds counts field-wise", () => {
    expect(
      sumRedactionCounts(
        { emails: 1, phones: 2, tokens: 0 },
        { emails: 0, phones: 1, tokens: 3 },
      ),
    ).toEqual({ emails: 1, phones: 3, tokens: 3 });
  });
});
