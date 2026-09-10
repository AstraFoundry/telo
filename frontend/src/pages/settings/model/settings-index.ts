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

import { copy } from "shared/config/copy";

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

/** One line saying what the pane decides, printed under its title. */
export const SECTION_SUBTITLES: Record<SettingsSectionId, string> = {
  account: copy.settingsAccountSubtitle,
  appearance: copy.appearanceSubtitle,
  chat: copy.chatSettingsSubtitle,
  notifications: copy.notificationsSubtitle,
  folders: copy.foldersSubtitle,
  agent: copy.agentSettingsSubtitle,
  storage: copy.dataAndStorageSubtitle,
};

export const SECTION_ICONS: Record<SettingsSectionId, Icon> = {
  account: UserCircle,
  appearance: Palette,
  chat: ChatCircleDots,
  notifications: Bell,
  folders: FolderOpen,
  agent: Sparkle,
  storage: HardDrives,
};

/**
 * Every setting the panes render, so search can answer with the setting
 * rather than only the section that holds it.
 *
 * `terms` carries the words a person is likely to type but the label does not
 * contain - "dark" for Theme, "sign out" for Log out - which is the
 * difference between a search that feels helpful and one that only matches
 * what is already on screen.
 *
 * `id` is the anchor the pane's row carries. Picking a result opens the
 * section and lands on that row, instead of dropping the reader at the top of
 * a pane to hunt for it again.
 */
export interface SettingsIndexEntry {
  readonly id: string;
  readonly section: SettingsSectionId;
  readonly label: string;
  readonly terms: ReadonlyArray<string>;
}

export const SETTINGS_INDEX: ReadonlyArray<SettingsIndexEntry> = [
  {
    id: "telegram-account",
    section: "account",
    label: copy.telegramAccount,
    terms: ["profile"],
  },
  {
    id: "account-connection",
    section: "account",
    label: copy.accountConnection,
    terms: ["reconnect", "session"],
  },
  {
    id: "log-out",
    section: "account",
    label: copy.logOut,
    terms: ["sign out", "logout"],
  },
  {
    id: "theme",
    section: "appearance",
    label: copy.theme,
    terms: ["dark", "light", "night mode"],
  },
  {
    id: "accent-color",
    section: "appearance",
    label: copy.accentColor,
    terms: ["colour"],
  },
  {
    id: "message-text-size",
    section: "appearance",
    label: copy.messageTextSize,
    terms: ["font size", "bigger text"],
  },
  {
    id: "chat-wallpaper",
    section: "appearance",
    label: copy.chatWallpaper,
    terms: ["wallpaper", "background", "pattern"],
  },
  {
    id: "reduce-motion",
    section: "appearance",
    label: copy.reduceMotion,
    terms: ["animation", "power saving", "battery"],
  },
  {
    id: "send-with-enter",
    section: "chat",
    label: copy.sendWithEnter,
    terms: ["enter", "return key"],
  },
  {
    id: "time-format",
    section: "chat",
    label: copy.timeFormat,
    terms: ["24-hour", "clock"],
  },
  {
    id: "loop-stickers",
    section: "chat",
    label: copy.loopStickers,
    terms: ["sticker", "animated"],
  },
  {
    id: "notifications-desktop",
    section: "notifications",
    label: copy.notificationsDesktop,
    terms: ["alerts"],
  },
  {
    id: "notify-direct-chats",
    section: "notifications",
    label: copy.notifyDirectChats,
    terms: ["private", "one to one", "dm"],
  },
  {
    id: "notify-group-chats",
    section: "notifications",
    label: copy.notifyGroupChats,
    terms: ["supergroup"],
  },
  {
    id: "notify-channels",
    section: "notifications",
    label: copy.notifyChannels,
    terms: ["broadcast"],
  },
  {
    id: "notification-sound",
    section: "notifications",
    label: copy.notificationSound,
    terms: ["silent", "mute", "ring", "audio"],
  },
  {
    id: "notification-sender-name",
    section: "notifications",
    label: copy.notificationSenderName,
    terms: ["name"],
  },
  {
    id: "notification-preview",
    section: "notifications",
    label: copy.notificationPreview,
    terms: ["message text", "body"],
  },
  {
    id: "count-muted-chats",
    section: "notifications",
    label: copy.countMutedChats,
    terms: ["badge", "unread"],
  },
  {
    id: "chat-folders",
    section: "folders",
    label: copy.serverFolders,
    terms: ["sync", "tabs", "filter"],
  },
  {
    id: "keyword-folders",
    section: "folders",
    label: copy.keywordFolders,
    terms: ["filter", "tabs"],
  },
  {
    id: "agent-provider",
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
      "kimi",
      "moonshot",
      "deepseek",
      "mistral",
      "compatible",
      "account",
    ],
  },
  {
    id: "agent-model",
    section: "agent",
    label: copy.model,
    terms: ["catalog"],
  },
  {
    id: "agent-base-url",
    section: "agent",
    label: copy.baseUrl,
    terms: ["endpoint"],
  },
  {
    id: "agent-account",
    section: "agent",
    label: copy.account,
    terms: ["oauth", "connect", "sign in"],
  },
  {
    id: "agent-api-key",
    section: "agent",
    label: copy.apiKey,
    terms: ["token", "secret"],
  },
  {
    id: "agent-instructions",
    section: "agent",
    label: copy.instructions,
    terms: ["system prompt"],
  },
  {
    id: "agent-inspect-workspace",
    section: "agent",
    label: copy.inspectWorkspace,
    terms: ["tools"],
  },
  {
    id: "agent-temperature",
    section: "agent",
    label: copy.agentTemperature,
    terms: ["sampling"],
  },
  {
    id: "agent-max-steps",
    section: "agent",
    label: copy.agentMaxSteps,
    terms: ["tool calls"],
  },
  {
    id: "agent-history-limit",
    section: "agent",
    label: copy.agentHistoryLimit,
    terms: ["context"],
  },
  {
    id: "auto-download-photos",
    section: "storage",
    label: copy.autoDownloadPhotos,
    terms: ["auto download", "images", "pictures"],
  },
  {
    id: "auto-download-videos",
    section: "storage",
    label: copy.autoDownloadVideos,
    terms: ["auto download", "gif", "animation"],
  },
  {
    id: "auto-download-files",
    section: "storage",
    label: copy.autoDownloadFiles,
    terms: ["auto download", "documents", "voice", "audio"],
  },
  {
    id: "media-cache-usage",
    section: "storage",
    label: copy.mediaCache,
    terms: ["disk", "downloads", "storage"],
  },
  {
    id: "media-cache-limit",
    section: "storage",
    label: copy.mediaCacheLimit,
    terms: ["size", "quota"],
  },
  {
    id: "clear-cache",
    section: "storage",
    label: copy.clearCache,
    terms: ["delete", "free up"],
  },
];

/** Case-folded once by the caller, so a keystroke does not re-fold the index. */
export function matchesSetting(
  entry: SettingsIndexEntry,
  query: string,
): boolean {
  if (entry.label.toLocaleLowerCase().includes(query)) return true;
  if (SECTION_TITLES[entry.section].toLocaleLowerCase().includes(query)) {
    return true;
  }
  return entry.terms.some((term) => term.includes(query));
}
