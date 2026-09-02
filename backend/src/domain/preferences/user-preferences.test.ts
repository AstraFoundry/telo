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
  sidebarWidth: 280,
  agentPanelWidth: 380,
  recentEmojis: [],
  messageTemplates: [],
  reduceMotion: false,
  loopStickers: true,
  notificationSenderName: true,
  notificationPreview: true,
  countMutedChats: false,
  mediaCacheLimitMb: 512,
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

  it("accepts column widths inside the supported ranges", () => {
    const preferences = UserPreferences.default().update({
      sidebarWidth: 320,
      agentPanelWidth: 480,
    });

    expect(preferences.snapshot()).toEqual({
      ...DEFAULTS,
      sidebarWidth: 320,
      agentPanelWidth: 480,
    });
  });

  it.each([199, 481, Number.NaN, "280", null])(
    "falls back to the default sidebar width for %s",
    (sidebarWidth) => {
      const stored = {
        ...DEFAULTS,
        sidebarWidth,
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot().sidebarWidth).toBe(280);
    },
  );

  it.each([279, 601, Number.NaN, "380", null])(
    "falls back to the default agent panel width for %s",
    (agentPanelWidth) => {
      const stored = {
        ...DEFAULTS,
        agentPanelWidth,
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot().agentPanelWidth).toBe(
        380,
      );
    },
  );

  it("keeps unique non-empty recent emoji glyphs, capped and in order", () => {
    const preferences = UserPreferences.default().update({
      recentEmojis: ["😀", "😀", "", "😂"],
    });

    expect(preferences.snapshot().recentEmojis).toEqual(["😀", "😂"]);
  });

  it.each([null, "😀", [1, null]])(
    "falls back to no recent emojis for malformed persisted values: %s",
    (recentEmojis) => {
      const stored = {
        ...DEFAULTS,
        recentEmojis,
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot().recentEmojis).toEqual(
        [],
      );
    },
  );

  it("keeps templates with a title and body, capped, and mints missing ids", () => {
    const preferences = UserPreferences.default().update({
      messageTemplates: [
        { id: "keep", title: "  Hello  ", body: "  Hi there  " },
        { id: " ", title: "Thanks", body: "Thank you" },
        { id: "drop", title: "   ", body: "nope" },
        { title: "No id", body: "still valid" } as never,
      ],
    });

    const templates = preferences.snapshot().messageTemplates;
    expect(templates).toHaveLength(3);
    expect(templates[0]).toEqual({
      id: "keep",
      title: "Hello",
      body: "Hi there",
    });
    expect(templates[1]).toMatchObject({ title: "Thanks", body: "Thank you" });
    expect(templates[1]?.id.length).toBeGreaterThan(0);
    expect(templates[2]).toMatchObject({ title: "No id", body: "still valid" });
  });

  it("accepts explicit values for the appearance and notification toggles", () => {
    const preferences = UserPreferences.default().update({
      reduceMotion: true,
      loopStickers: false,
      notificationSenderName: false,
      notificationPreview: false,
      countMutedChats: true,
    });

    expect(preferences.snapshot()).toEqual({
      ...DEFAULTS,
      reduceMotion: true,
      loopStickers: false,
      notificationSenderName: false,
      notificationPreview: false,
      countMutedChats: true,
    });
  });

  it.each([
    ["reduceMotion", false],
    ["loopStickers", true],
    ["notificationSenderName", true],
    ["notificationPreview", true],
    ["countMutedChats", false],
  ] as const)(
    "falls back to the %s default for a malformed persisted value",
    (key, fallback) => {
      const stored = {
        ...DEFAULTS,
        [key]: "yes",
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot()[key]).toBe(fallback);
    },
  );

  it("clamps the media cache limit to the supported range", () => {
    const clamped = (mediaCacheLimitMb: number): number =>
      UserPreferences.default().update({ mediaCacheLimitMb }).snapshot()
        .mediaCacheLimitMb;

    expect(clamped(1)).toBe(64);
    expect(clamped(64)).toBe(64);
    expect(clamped(1024)).toBe(1024);
    expect(clamped(4096)).toBe(4096);
    expect(clamped(999_999)).toBe(4096);
    expect(clamped(700.4)).toBe(700);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "512", null])(
    "falls back to the default media cache limit for %s",
    (mediaCacheLimitMb) => {
      const stored = {
        ...DEFAULTS,
        mediaCacheLimitMb,
      } as unknown as Parameters<typeof UserPreferences.create>[0];

      expect(UserPreferences.create(stored).snapshot().mediaCacheLimitMb).toBe(
        512,
      );
    },
  );

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
