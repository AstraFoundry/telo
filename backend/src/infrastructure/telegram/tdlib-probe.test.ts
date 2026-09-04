import { describe, expect, it } from "vitest";

import { runTdlibSmoke } from "./tdlib-probe";

describe("runTdlibSmoke", () => {
  it("loads libtdjson and accepts TDLib parameters", async () => {
    const result = await runTdlibSmoke({
      isPackaged: false,
      resourcesPath: "/unused",
    });
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.tdjson).toMatch(/tdjson|libtdjson/i);
    expect(result.authorizationStates).toContain(
      "authorizationStateWaitTdlibParameters",
    );
    expect(result.authorizationStates).toContain(
      "authorizationStateWaitPhoneNumber",
    );
  });
});
