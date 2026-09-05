import { describe, expect, it } from "vitest";

import { copy } from "shared/config/copy";

import { secretChatStatus } from "./secret-chat-status";

describe("secretChatStatus", () => {
  it("matches Telegram Desktop copy for each secret-chat state", () => {
    expect(secretChatStatus("pending")).toBe(copy.secretChatWaiting);
    expect(secretChatStatus("closed")).toBe(copy.secretChatClosed);
    expect(secretChatStatus("ready")).toBe(copy.secretChatDeviceLocal);
    expect(secretChatStatus(undefined)).toBe(copy.secretChatDeviceLocal);
  });
});
