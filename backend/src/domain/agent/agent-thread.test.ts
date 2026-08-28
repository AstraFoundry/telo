import { describe, expect, it } from "vitest";

import { AgentThread } from "./agent-thread";

const NOW = "2026-08-27T12:00:00.000Z";

describe("AgentThread", () => {
  it("creates an empty thread with the given id and timestamps", () => {
    const thread = AgentThread.create({ threadId: "thread-1", now: NOW });

    expect(thread.snapshot()).toEqual({
      threadId: "thread-1",
      createdAt: NOW,
      updatedAt: NOW,
      messages: [],
    });
    expect(thread.title()).toBe("");
  });

  it("rejects a blank thread id", () => {
    expect(() => AgentThread.create({ threadId: "  ", now: NOW })).toThrow(
      "Agent thread id is required",
    );
  });

  it("appends a message immutably and bumps updatedAt", () => {
    const thread = AgentThread.create({ threadId: "thread-1", now: NOW });
    const later = "2026-08-27T12:01:00.000Z";

    const next = thread.append({
      id: "msg-1",
      role: "user",
      body: "  Summarize this chat  ",
      sentAt: later,
    });

    expect(thread.snapshot().messages).toEqual([]);
    expect(thread.snapshot().updatedAt).toBe(NOW);
    expect(next.snapshot().messages).toEqual([
      { id: "msg-1", role: "user", body: "Summarize this chat", sentAt: later },
    ]);
    expect(next.snapshot().updatedAt).toBe(later);
  });

  it("rejects a blank message body", () => {
    const thread = AgentThread.create({ threadId: "thread-1", now: NOW });

    expect(() =>
      thread.append({ id: "msg-1", role: "user", body: " ", sentAt: NOW }),
    ).toThrow("Agent thread message body is required");
  });

  it("derives the title from the first user message", () => {
    let thread = AgentThread.create({ threadId: "thread-1", now: NOW });
    thread = thread.append({
      id: "msg-1",
      role: "assistant",
      body: "Hello",
      sentAt: NOW,
    });
    expect(thread.title()).toBe("");

    thread = thread.append({
      id: "msg-2",
      role: "user",
      body: "Summarize this chat",
      sentAt: NOW,
    });
    thread = thread.append({
      id: "msg-3",
      role: "user",
      body: "And the other one",
      sentAt: NOW,
    });

    expect(thread.title()).toBe("Summarize this chat");
    expect(thread.summary()).toEqual({
      threadId: "thread-1",
      title: "Summarize this chat",
      updatedAt: NOW,
    });
  });

  it("truncates a long first user message in the title", () => {
    const thread = AgentThread.create({
      threadId: "thread-1",
      now: NOW,
    }).append({
      id: "msg-1",
      role: "user",
      body: "x".repeat(80),
      sentAt: NOW,
    });

    expect(thread.title()).toBe(`${"x".repeat(60)}…`);
  });

  it("restores a snapshot defensively", () => {
    const snapshot = AgentThread.create({ threadId: "thread-1", now: NOW })
      .append({ id: "msg-1", role: "user", body: "Hi", sentAt: NOW })
      .snapshot();

    const restored = AgentThread.restore(snapshot);

    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.snapshot().messages).not.toBe(snapshot.messages);
  });

  it("keeps the error flag through append, snapshot, and restore", () => {
    const thread = AgentThread.create({
      threadId: "thread-1",
      now: NOW,
    }).append({
      id: "msg-1",
      role: "assistant",
      body: "Provider unavailable",
      sentAt: NOW,
      error: true,
    });

    const restored = AgentThread.restore(thread.snapshot());

    expect(restored.snapshot().messages[0]).toEqual({
      id: "msg-1",
      role: "assistant",
      body: "Provider unavailable",
      sentAt: NOW,
      error: true,
    });
  });
});
