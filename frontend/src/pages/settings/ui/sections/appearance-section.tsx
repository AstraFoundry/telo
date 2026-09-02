import { useId } from "react";

import type {
  AccentColorPreference,
  ThemePreference,
} from "../../../../../../contracts/src/ipc";
import {
  MESSAGE_TEXT_SIZE_MAX,
  MESSAGE_TEXT_SIZE_MIN,
  useAccentColor,
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

export function AppearanceSection() {
  const theme = useTheme();
  const accent = useAccentColor();
  const messageTextSize = useMessageTextSize();
  const reduceMotion = useReduceMotion();
  const reduceMotionId = useId();
  const reduceMotionHintId = useId();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup>
        <SettingsRow label={copy.theme}>
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
        <SettingsStackedRow label={copy.accentColor}>
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
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={copy.reduceMotion}
          description={copy.reduceMotionHint}
          labelFor={reduceMotionId}
          descriptionId={reduceMotionHintId}
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
