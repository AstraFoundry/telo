import { describe, expect, it, vi } from "vitest";

import { wrapTdlibClient } from "./tdlib-client";

describe("wrapTdlibClient", () => {
  it("forwards invoke, update, and close", async () => {
    const handler = vi.fn();
    const client = {
      invoke: vi.fn(async () => ({ _: "ok" })),
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(async () => undefined),
      isClosed: vi.fn(() => false),
    };
    const bridge = wrapTdlibClient(client as never);
    await expect(bridge.invoke({ _: "getMe" })).resolves.toEqual({ _: "ok" });
    const unsubscribe = bridge.onUpdate(handler);
    expect(client.on).toHaveBeenCalledWith("update", expect.any(Function));
    const registered = client.on.mock.calls[0]?.[1] as (update: {
      _: string;
    }) => void;
    registered({ _: "updateConnectionState" });
    expect(handler).toHaveBeenCalled();
    unsubscribe();
    expect(client.off).toHaveBeenCalled();
    await bridge.close();
    expect(client.close).toHaveBeenCalled();
    expect(bridge.isClosed()).toBe(false);
  });
});
