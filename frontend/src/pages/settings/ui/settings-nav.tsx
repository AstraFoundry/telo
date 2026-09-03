import {
  Bell,
  ChatCircleDots,
  FolderOpen,
  HardDrives,
  Palette,
  Sparkle,
  UserCircle,
  type Icon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { copy } from "shared/config/copy";
import { Button, Input } from "shared/ui";

export const SETTINGS_SECTIONS = [
  "account",
  "appearance",
  "chat",
  "notifications",
  "folders",
  "agent",
  "storage",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_TITLES: Record<SettingsSectionId, string> = {
  account: copy.settingsAccount,
  appearance: copy.appearance,
  chat: copy.chatSettings,
  notifications: copy.notifications,
  folders: copy.folders,
  agent: copy.agentSettings,
  storage: copy.dataAndStorage,
};

const SECTION_ICONS: Record<SettingsSectionId, Icon> = {
  account: UserCircle,
  appearance: Palette,
  chat: ChatCircleDots,
  notifications: Bell,
  folders: FolderOpen,
  agent: Sparkle,
  storage: HardDrives,
};

/**
 * Every setting the panes render, so search can answer with the setting rather
 * than only the section that holds it. `terms` carries the words a person is
 * likely to type but the label does not contain - "dark" for Theme, "sign out"
 * for Log out - which is the difference between a search that feels helpful
 * and one that only matches what is already on screen.
 */
interface SettingsIndexEntry {
  readonly section: SettingsSectionId;
  readonly label: string;
  readonly terms: ReadonlyArray<string>;
}

export const SETTINGS_INDEX: ReadonlyArray<SettingsIndexEntry> = [
  { section: "account", label: copy.telegramAccount, terms: ["profile"] },
  {
    section: "account",
    label: copy.accountConnection,
    terms: ["reconnect", "session"],
  },
  { section: "account", label: copy.logOut, terms: ["sign out", "logout"] },
  {
    section: "appearance",
    label: copy.theme,
    terms: ["dark", "light", "night mode"],
  },
  { section: "appearance", label: copy.accentColor, terms: ["colour"] },
  {
    section: "appearance",
    label: copy.messageTextSize,
    terms: ["font size", "bigger text"],
  },
  {
    section: "appearance",
    label: copy.reduceMotion,
    terms: ["animation", "power saving", "battery"],
  },
  {
    section: "chat",
    label: copy.sendWithEnter,
    terms: ["enter", "return key"],
  },
  { section: "chat", label: copy.timeFormat, terms: ["24-hour", "clock"] },
  { section: "chat", label: copy.loopStickers, terms: ["sticker", "animated"] },
  {
    section: "notifications",
    label: copy.notificationsDesktop,
    terms: ["alerts"],
  },
  {
    section: "notifications",
    label: copy.notificationSenderName,
    terms: ["name"],
  },
  {
    section: "notifications",
    label: copy.notificationPreview,
    terms: ["message text", "body"],
  },
  {
    section: "notifications",
    label: copy.countMutedChats,
    terms: ["badge", "unread"],
  },
  {
    section: "folders",
    label: copy.keywordFolders,
    terms: ["filter", "tabs"],
  },
  {
    section: "agent",
    label: copy.provider,
    terms: [
      "openai",
      "anthropic",
      "claude",
      "google",
      "gemini",
      "groq",
      "xai",
      "grok",
      "deepseek",
      "mistral",
      "compatible",
      "account",
    ],
  },
  { section: "agent", label: copy.model, terms: [] },
  { section: "agent", label: copy.baseUrl, terms: ["endpoint"] },
  { section: "agent", label: copy.apiKey, terms: ["token", "secret"] },
  { section: "agent", label: copy.instructions, terms: ["system prompt"] },
  { section: "agent", label: copy.inspectWorkspace, terms: ["tools"] },
  { section: "agent", label: copy.agentTemperature, terms: ["sampling"] },
  { section: "agent", label: copy.agentMaxSteps, terms: ["tool calls"] },
  { section: "agent", label: copy.agentHistoryLimit, terms: ["context"] },
  {
    section: "storage",
    label: copy.mediaCache,
    terms: ["disk", "downloads", "storage"],
  },
  {
    section: "storage",
    label: copy.mediaCacheLimit,
    terms: ["size", "quota"],
  },
  { section: "storage", label: copy.clearCache, terms: ["delete", "free up"] },
];

function matches(entry: SettingsIndexEntry, query: string): boolean {
  if (entry.label.toLocaleLowerCase().includes(query)) return true;
  if (SECTION_TITLES[entry.section].toLocaleLowerCase().includes(query)) {
    return true;
  }
  return entry.terms.some((term) => term.includes(query));
}

interface SettingsNavProps {
  readonly active: SettingsSectionId;
  readonly query: string;
  onQueryChange(query: string): void;
  onSelect(section: SettingsSectionId): void;
}

/**
 * Section rail. Sections are always all visible, which is the whole reason a
 * rail beats a long scroll once a settings surface passes a handful of groups:
 * there is nothing to discover by scrolling.
 *
 * Typing replaces the section list with matching settings, each labelled with
 * the section that owns it, so the answer to "where is dark mode" is one click
 * rather than a hunt. The active row reuses the same secondary-surface
 * treatment every other toggle in the app uses; a rail is not the place to
 * introduce a second visual language for "selected".
 */
export function SettingsNav({
  active,
  query,
  onQueryChange,
  onSelect,
}: SettingsNavProps) {
  const trimmed = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      trimmed ? SETTINGS_INDEX.filter((entry) => matches(entry, trimmed)) : [],
    [trimmed],
  );

  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col gap-2 border-r border-border p-3">
      <Input
        value={query}
        onChange={onQueryChange}
        placeholder={copy.settingsSearch}
        aria-label={copy.settingsSearch}
      />
      {trimmed ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {results.map((entry) => (
                <li key={`${entry.section}-${entry.label}`}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-lg px-2.5 py-1.5 text-left"
                    onClick={() => {
                      onSelect(entry.section);
                      onQueryChange("");
                    }}
                  >
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate text-sm text-foreground">
                        {entry.label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {SECTION_TITLES[entry.section]}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {copy.settingsNoResults}
            </p>
          )}
        </div>
      ) : (
        <nav aria-label={copy.settings} className="min-h-0 flex-1">
          <ul className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((section) => {
              const SectionIcon = SECTION_ICONS[section];
              const selected = section === active;
              return (
                <li key={section}>
                  <Button
                    variant={selected ? "secondary" : "ghost"}
                    aria-current={selected ? "page" : undefined}
                    className="w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm"
                    onClick={() => onSelect(section)}
                  >
                    <SectionIcon
                      aria-hidden="true"
                      weight={selected ? "fill" : "regular"}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{SECTION_TITLES[section]}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
