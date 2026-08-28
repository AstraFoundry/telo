import type {
  AccentColorPreference,
  ThemePreference,
  TimeFormatPreference,
} from "../../../../contracts/src/ipc";

export interface UserPreferencesSnapshot {
  readonly agentPanelOpen: boolean;
  readonly demoWorkspace: boolean;
  readonly theme: ThemePreference;
  readonly accentColor: AccentColorPreference;
  readonly messageTextSize: number;
  readonly timeFormat: TimeFormatPreference;
  readonly sendWithEnter: boolean;
  readonly notificationsEnabled: boolean;
}

export const MESSAGE_TEXT_SIZE_DEFAULT = 14;
export const MESSAGE_TEXT_SIZE_MIN = 12;
export const MESSAGE_TEXT_SIZE_MAX = 18;

export class UserPreferences {
  private constructor(private readonly value: UserPreferencesSnapshot) {}

  static create(input: UserPreferencesSnapshot): UserPreferences {
    return new UserPreferences({
      agentPanelOpen: Boolean(input.agentPanelOpen),
      demoWorkspace: Boolean(input.demoWorkspace),
      theme: normalizeTheme(input.theme),
      accentColor: normalizeAccentColor(input.accentColor),
      messageTextSize: normalizeMessageTextSize(input.messageTextSize),
      timeFormat: normalizeTimeFormat(input.timeFormat),
      sendWithEnter: normalizeBoolean(input.sendWithEnter, true),
      notificationsEnabled: normalizeBoolean(input.notificationsEnabled, true),
    });
  }

  static default(): UserPreferences {
    return UserPreferences.create({
      agentPanelOpen: false,
      demoWorkspace: false,
      theme: "system",
      accentColor: "blue",
      messageTextSize: MESSAGE_TEXT_SIZE_DEFAULT,
      timeFormat: "system",
      sendWithEnter: true,
      notificationsEnabled: true,
    });
  }

  update(patch: Partial<UserPreferencesSnapshot>): UserPreferences {
    return UserPreferences.create({ ...this.value, ...patch });
  }

  snapshot(): UserPreferencesSnapshot {
    return { ...this.value };
  }
}

// Persisted files may predate a preference or carry an unrecognized value;
// every normalize helper falls back to that preference's default in both cases.
function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

function normalizeAccentColor(value: unknown): AccentColorPreference {
  return value === "blue" ||
    value === "green" ||
    value === "purple" ||
    value === "red" ||
    value === "orange"
    ? value
    : "blue";
}

function normalizeMessageTextSize(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MESSAGE_TEXT_SIZE_MIN &&
    value <= MESSAGE_TEXT_SIZE_MAX
    ? value
    : MESSAGE_TEXT_SIZE_DEFAULT;
}

function normalizeTimeFormat(value: unknown): TimeFormatPreference {
  return value === "system" || value === "12h" || value === "24h"
    ? value
    : "system";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
