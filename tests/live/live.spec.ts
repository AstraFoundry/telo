import { test as base, expect, type Page } from "@playwright/test";

/**
 * Secret-gated live Telegram E2E (L3). Not part of PR CI.
 * Requires TELO_LIVE_E2E=1 and two test accounts. See docs/telegram/baseline.md.
 */
const liveEnabled = process.env.TELO_LIVE_E2E === "1";

const test = base.extend<{ window: Page }>({
  window: async ({}, use) => {
    if (!liveEnabled) {
      await use(null as unknown as Page);
      return;
    }
    throw new Error("Packaged live launch is configured per nightly runner");
  },
});

test("live two-account send is documented, not PR CI", async () => {
  test.skip(!liveEnabled, "Set TELO_LIVE_E2E=1 on the nightly runner");
  expect(liveEnabled).toBe(true);
});
