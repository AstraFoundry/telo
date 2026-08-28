import { describe, expect, it } from "vitest";

import { UserPreferences } from "./user-preferences";

const DEFAULTS = {
  agentPanelOpen: false,
  demoWorkspace: false,
  theme: "system",
  accentColor: "blue",
  messageTextSize: 14,
  timeFormat: "system",
  sendWithEnter: true,
  notificationsEnabled: true,
} as const;

describe("UserPreferences", () => {
  it("defaults to a closed agent panel outside the demo workspace with the system theme", () => {
    expect(UserPreferences.default().snapshot()).toEqual(DEFAULTS);
  });

  it("applies a partial update without touching other preferences", () => {
    const preferences = UserPreferences.default().update({
      agentPanelOpen: true,
    });

    expect(preferences.snapshot()).toEqual({
      ...DEFAULTS,
      agentPanelOpen: true,
    });
  });

  it("coerces persisted values to booleans", () => {
    const preferences = UserPreferences.create({
      ...DEFAULTS,
      agentPanelOpen: true,
      theme: "dark",
    });

    expect(preferences.snapshot()).toEqual({
      ...DEFAULTS,
      agentPanelOpen: true,
      theme: "dark",
    });
  });

  it("accepts every supported theme", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      expect(UserPreferences.default().update({ theme }).snapshot().theme).toBe(
        theme,
      );
    }
  });

  it("falls back to the system theme for unrecognized persisted values", () => {
    const stored = {
      ...DEFAULTS,
      theme: "neon",
    } as unknown as Parameters<typeof UserPreferences.create>[0];

    expect(UserPreferences.create(stored).snapshot().theme).toBe("system");
  });

  it("accepts every supported accent color", () => {
    for (const accentColor of [
      "blue",
      "green",
      "purple",
      "red",
      "orange",
    ] as const) {
      expect(
        UserPreferences.default().update({ accentColor }).snapshot()
          .accentColor,
      ).toBe(accentColor);
    }
  });

  it("falls back to the blue accent color for unrecognized persisted values", () => {
    const stored = {
      ...DEFAULTS,
      accentColor: "neon",
    } as unknown as Parameters<typeof UserPreferences.create>[0];

    expect(UserPreferences.create(stored).snapshot().accentColor).toBe("blue");
  });

  it("accepts message text sizes inside the supported range", () => {
    for (const messageTextSize of [12, 14, 18]) {
      expect(
        UserPreferences.default().update({ messageTextSize }).snapshot()
          .messageTextSize,
      ).toBe(messageTextSize);
    }
  });

  it.each([11, 19, Number.NaN, "14", null])(
    "falls back to the default message text size for %s",
    (messageTextSize) => {
      const stored = {
        ...DEFAULTS,
        messageTextSize,
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot().messageTextSize).toBe(
        14,
      );
    },
  );

  it("accepts every supported time format", () => {
    for (const timeFormat of ["system", "12h", "24h"] as const) {
      expect(
        UserPreferences.default().update({ timeFormat }).snapshot().timeFormat,
      ).toBe(timeFormat);
    }
  });

  it("falls back to the system time format for unrecognized persisted values", () => {
    const stored = {
      ...DEFAULTS,
      timeFormat: "24-hour",
    } as unknown as Parameters<typeof UserPreferences.create>[0];

    expect(UserPreferences.create(stored).snapshot().timeFormat).toBe("system");
  });

  it("accepts explicit boolean values for sendWithEnter and notificationsEnabled", () => {
    const preferences = UserPreferences.default().update({
      sendWithEnter: false,
      notificationsEnabled: false,
    });

    expect(preferences.snapshot()).toEqual({
      ...DEFAULTS,
      sendWithEnter: false,
      notificationsEnabled: false,
    });
  });

  it("falls back to enabled for malformed boolean preferences", () => {
    const stored = {
      ...DEFAULTS,
      sendWithEnter: "no",
      notificationsEnabled: 0,
    } as unknown as Parameters<typeof UserPreferences.create>[0];

    expect(UserPreferences.create(stored).snapshot()).toEqual(DEFAULTS);
  });

  it("falls back to defaults when the persisted file predates the new preferences", () => {
    const stored = {
      agentPanelOpen: true,
      demoWorkspace: false,
    } as unknown as Parameters<typeof UserPreferences.create>[0];

    expect(UserPreferences.create(stored).snapshot()).toEqual({
      ...DEFAULTS,
      agentPanelOpen: true,
    });
  });
});
