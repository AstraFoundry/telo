import type {
  AccentColorPreference,
  MessageTemplateDto,
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
  readonly sidebarWidth: number;
  readonly agentPanelWidth: number;
  readonly recentEmojis: ReadonlyArray<string>;
  readonly messageTemplates: ReadonlyArray<MessageTemplateDto>;
}

export const MESSAGE_TEXT_SIZE_DEFAULT = 14;
export const MESSAGE_TEXT_SIZE_MIN = 12;
export const MESSAGE_TEXT_SIZE_MAX = 18;

export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 480;

export const AGENT_PANEL_WIDTH_DEFAULT = 380;
export const AGENT_PANEL_WIDTH_MIN = 280;
export const AGENT_PANEL_WIDTH_MAX = 600;

export const RECENT_EMOJIS_MAX = 24;

export const MESSAGE_TEMPLATES_MAX = 50;
export const MESSAGE_TEMPLATE_TITLE_MAX = 80;
export const MESSAGE_TEMPLATE_BODY_MAX = 2000;

/** Seeded into an empty demo workspace so the composer picker has replies to insert. */
export const DEMO_MESSAGE_TEMPLATES: ReadonlyArray<MessageTemplateDto> = [
  {
    id: "demo-template-on-it",
    title: "On it",
    body: "On it \u2014 I'll take this.",
  },
  {
    id: "demo-template-thanks",
    title: "Thanks",
    body: "Thanks, this is exactly what we needed.",
  },
];

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
      sidebarWidth: normalizeWidth(
        input.sidebarWidth,
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
        SIDEBAR_WIDTH_DEFAULT,
      ),
      agentPanelWidth: normalizeWidth(
        input.agentPanelWidth,
        AGENT_PANEL_WIDTH_MIN,
        AGENT_PANEL_WIDTH_MAX,
        AGENT_PANEL_WIDTH_DEFAULT,
      ),
      recentEmojis: normalizeRecentEmojis(input.recentEmojis),
      messageTemplates: normalizeMessageTemplates(input.messageTemplates),
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
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      agentPanelWidth: AGENT_PANEL_WIDTH_DEFAULT,
      recentEmojis: [],
      messageTemplates: [],
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

// Persisted files may predate the preference or carry non-string entries;
// keep only unique non-empty glyphs, capped so a corrupt file stays small.
function normalizeRecentEmojis(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  const glyphs: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!glyphs.includes(entry)) glyphs.push(entry);
    if (glyphs.length >= RECENT_EMOJIS_MAX) break;
  }
  return glyphs;
}

// Persisted files may predate the preference or carry malformed entries;
// keep only templates with a trimmed non-empty title and body, capped so a
// corrupt file stays small. Entries without a usable id get a fresh one.
function normalizeMessageTemplates(
  value: unknown,
): ReadonlyArray<MessageTemplateDto> {
  if (!Array.isArray(value)) return [];
  const templates: MessageTemplateDto[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, title, body } = entry as Record<string, unknown>;
    if (typeof title !== "string" || typeof body !== "string") continue;
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) continue;
    templates.push({
      id: typeof id === "string" && id.trim() ? id : crypto.randomUUID(),
      title: trimmedTitle.slice(0, MESSAGE_TEMPLATE_TITLE_MAX),
      body: trimmedBody.slice(0, MESSAGE_TEMPLATE_BODY_MAX),
    });
    if (templates.length >= MESSAGE_TEMPLATES_MAX) break;
  }
  return templates;
}

function normalizeWidth(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}
