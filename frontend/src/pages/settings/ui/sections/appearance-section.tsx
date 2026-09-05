import { useId } from "react";

import type {
  AccentColorPreference,
  ChatWallpaperPreference,
  ThemePreference,
} from "../../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import {
  MESSAGE_TEXT_SIZE_MAX,
  MESSAGE_TEXT_SIZE_MIN,
  useAccentColor,
  useChatWallpaper,
  useMessageTextSize,
  useReduceMotion,
  useTheme,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  RadioGroup,
  RadioGroupItem,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  Switch,
} from "shared/ui";

import { ConversationPreview } from "../previews/conversation-preview";

const ACCENT_CHOICES: readonly AccentColorPreference[] = [
  "blue",
  "green",
  "purple",
  "red",
  "orange",
];

const ACCENT_COPY: Record<AccentColorPreference, string> = {
  blue: copy.accentBlue,
  green: copy.accentGreen,
  purple: copy.accentPurple,
  red: copy.accentRed,
  orange: copy.accentOrange,
};

const WALLPAPER_CHOICES: readonly ChatWallpaperPreference[] = [
  "plain",
  "dots",
  "grid",
  "gradient",
];

const WALLPAPER_COPY: Record<ChatWallpaperPreference, string> = {
  plain: copy.wallpaperPlain,
  dots: copy.wallpaperDots,
  grid: copy.wallpaperGrid,
  gradient: copy.wallpaperGradient,
};

export function AppearanceSection() {
  const theme = useTheme();
  const accent = useAccentColor();
  const messageTextSize = useMessageTextSize();
  const wallpaper = useChatWallpaper();
  const reduceMotion = useReduceMotion();
  const reduceMotionId = useId();
  const reduceMotionHintId = useId();
  // A line the reader has actually seen beats a sample: the preview is then
  // literally their own conversation at the size and colour they are picking.
  const sampleLine = useChatStore(
    (state) => state.chats.find((chat) => chat.preview.trim())?.preview ?? null,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Preview first. Every control below changes this card, and a preview
          under the controls that changed it is a preview nobody scrolls back
          up to see. */}
      <SettingsGroup>
        <div className="p-2">
          <ConversationPreview incoming={sampleLine ?? undefined} />
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow label={copy.theme} settingId="theme">
          <Select
            value={theme.choice}
            onValueChange={(value) => theme.select(value as ThemePreference)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{copy.themeSystem}</SelectItem>
              <SelectItem value="light">{copy.themeLight}</SelectItem>
              <SelectItem value="dark">{copy.themeDark}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsStackedRow label={copy.accentColor} settingId="accent-color">
          <RadioGroup
            orientation="horizontal"
            value={accent.value}
            onValueChange={(value) =>
              accent.select(value as AccentColorPreference)
            }
          >
            {ACCENT_CHOICES.map((choice) => (
              <RadioGroupItem
                key={choice}
                value={choice}
                label={ACCENT_COPY[choice]}
              />
            ))}
          </RadioGroup>
        </SettingsStackedRow>
        <SettingsStackedRow
          label={copy.messageTextSize}
          value={`${messageTextSize.value}`}
          settingId="message-text-size"
        >
          <RangeSlider
            min={MESSAGE_TEXT_SIZE_MIN}
            max={MESSAGE_TEXT_SIZE_MAX}
            step={1}
            value={messageTextSize.value}
            onValueChange={messageTextSize.select}
            aria-label={copy.messageTextSize}
          />
        </SettingsStackedRow>
        <SettingsStackedRow
          label={copy.chatWallpaper}
          description={copy.chatWallpaperHint}
          settingId="chat-wallpaper"
        >
          <RadioGroup
            orientation="horizontal"
            value={wallpaper.value}
            onValueChange={(value) =>
              wallpaper.select(value as ChatWallpaperPreference)
            }
          >
            {WALLPAPER_CHOICES.map((choice) => (
              <RadioGroupItem
                key={choice}
                value={choice}
                label={WALLPAPER_COPY[choice]}
              />
            ))}
          </RadioGroup>
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={copy.reduceMotion}
          description={copy.reduceMotionHint}
          labelFor={reduceMotionId}
          descriptionId={reduceMotionHintId}
          settingId="reduce-motion"
        >
          <Switch
            id={reduceMotionId}
            describedBy={reduceMotionHintId}
            checked={reduceMotion.value}
            onCheckedChange={reduceMotion.select}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
