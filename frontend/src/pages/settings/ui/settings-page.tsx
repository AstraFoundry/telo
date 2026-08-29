import { ArrowLeft, SignOut } from "@phosphor-icons/react";
import { useState } from "react";

import type {
  AccentColorPreference,
  ThemePreference,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import {
  MESSAGE_TEXT_SIZE_MAX,
  MESSAGE_TEXT_SIZE_MIN,
  useAccentColor,
  useMessageTextSize,
  useNotificationsEnabled,
  useSendWithEnter,
  useTheme,
  useTimeFormat,
} from "entities/preferences";
import { useTelegramStore } from "entities/telegram";
import { AgentConfigurationForm } from "features/configure-agent";
import { TelegramConnectionForm } from "features/connect-telegram";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  RadioGroup,
  RadioGroupItem,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatefulButton,
  Switch,
  Tooltip,
  type ButtonState,
} from "shared/ui";

import { SettingRow } from "./setting-row";

const ACCENT_CHOICES: readonly AccentColorPreference[] = [
  "blue",
  "green",
  "purple",
  "red",
  "orange",
];

const ACCENT_COPY = {
  blue: copy.accentBlue,
  green: copy.accentGreen,
  purple: copy.accentPurple,
  red: copy.accentRed,
  orange: copy.accentOrange,
} as const;

const TIME_FORMAT_CHOICES: readonly {
  value: TimeFormatPreference;
  label: string;
}[] = [
  { value: "system", label: copy.timeFormatSystem },
  { value: "12h", label: copy.timeFormat12h },
  { value: "24h", label: copy.timeFormat24h },
];

interface SettingsPageProps {
  onBack(): void;
  /** Called after a successful log out so the shell can drop demo state. */
  onLoggedOut?(): void;
}

export function SettingsPage({ onBack, onLoggedOut }: SettingsPageProps) {
  const currentUser = useTelegramStore((state) => state.currentUser);
  const logout = useTelegramStore((state) => state.logout);
  const theme = useTheme();
  const accent = useAccentColor();
  const messageTextSize = useMessageTextSize();
  const timeFormat = useTimeFormat();
  const sendWithEnter = useSendWithEnter();
  const notificationsEnabled = useNotificationsEnabled();
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [confirmingLogOut, setConfirmingLogOut] = useState(false);
  const [logOutState, setLogOutState] = useState<ButtonState>("idle");

  // Two-step confirm: the first click arms the button, the second executes.
  const handleLogOut = async () => {
    if (!confirmingLogOut) {
      setConfirmingLogOut(true);
      return;
    }
    setConfirmingLogOut(false);
    setLogOutState("loading");
    try {
      const { demoWorkspace } = await window.telo.preferences.get();
      await logout();
      // Demo logout is a backend no-op; leaving the demo workspace is owned
      // by the renderer clearing the preference, then the shell dropping its
      // in-memory demo flag so the workspace is disabled again.
      if (demoWorkspace) {
        await window.telo.preferences.update({ demoWorkspace: false });
      }
      setLogOutState("success");
      onLoggedOut?.();
    } catch {
      setLogOutState("error");
    }
  };

  return (
    <main className="flex min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 [app-region:drag]">
        <Tooltip content={copy.backToConversation}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.backToConversation}
            onClick={onBack}
            className="[app-region:no-drag]"
          >
            <ArrowLeft />
          </Button>
        </Tooltip>
        {/* deslop-ignore-next-line 12 — compact toolbar title is an app chrome convention */}
        <h1 className="text-base font-semibold text-balance">
          {copy.settings}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-6 py-8">
          <section aria-labelledby="appearance-settings-title">
            {/* deslop-ignore-next-line 12 */}
            <h2
              id="appearance-settings-title"
              className="mb-5 text-sm font-semibold text-balance"
            >
              {copy.appearance}
            </h2>
            <div className="flex flex-col gap-6">
              <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium">
                {copy.theme}
                <Select
                  value={theme.choice}
                  onValueChange={(value) =>
                    theme.select(value as ThemePreference)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">{copy.themeSystem}</SelectItem>
                    <SelectItem value="light">{copy.themeLight}</SelectItem>
                    <SelectItem value="dark">{copy.themeDark}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <div
                role="group"
                aria-label={copy.accentColor}
                className="flex flex-col gap-2"
              >
                <span className="text-sm font-medium">{copy.accentColor}</span>
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
              </div>

              <div className="flex max-w-xs flex-col gap-2">
                <div className="flex items-baseline justify-between gap-6">
                  <span className="text-sm font-medium">
                    {copy.messageTextSize}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {messageTextSize.value}
                  </span>
                </div>
                <RangeSlider
                  min={MESSAGE_TEXT_SIZE_MIN}
                  max={MESSAGE_TEXT_SIZE_MAX}
                  step={1}
                  value={messageTextSize.value}
                  onValueChange={messageTextSize.select}
                  aria-label={copy.messageTextSize}
                />
              </div>

              <div
                role="group"
                aria-label={copy.timeFormat}
                className="flex flex-col gap-2"
              >
                <span className="text-sm font-medium">{copy.timeFormat}</span>
                <RadioGroup
                  orientation="horizontal"
                  value={timeFormat.value}
                  onValueChange={(value) =>
                    timeFormat.select(value as TimeFormatPreference)
                  }
                >
                  {TIME_FORMAT_CHOICES.map((choice) => (
                    <RadioGroupItem
                      key={choice.value}
                      value={choice.value}
                      label={choice.label}
                    />
                  ))}
                </RadioGroup>
              </div>
            </div>
          </section>

          <section
            aria-labelledby="messages-settings-title"
            className="border-t pt-8"
          >
            {/* deslop-ignore-next-line 12 */}
            <h2
              id="messages-settings-title"
              className="mb-5 text-sm font-semibold text-balance"
            >
              {copy.messages}
            </h2>
            <div
              role="group"
              aria-label={copy.sendWithEnter}
              className="flex flex-col gap-2"
            >
              <span className="text-sm font-medium">{copy.sendWithEnter}</span>
              <RadioGroup
                orientation="horizontal"
                value={sendWithEnter.value ? "enter" : "cmd-enter"}
                onValueChange={(value) =>
                  sendWithEnter.select(value === "enter")
                }
              >
                <RadioGroupItem value="enter" label={copy.sendWithEnterEnter} />
                <RadioGroupItem
                  value="cmd-enter"
                  label={copy.sendWithEnterCmdEnter}
                />
              </RadioGroup>
            </div>
          </section>

          <section
            aria-labelledby="notifications-settings-title"
            className="border-t pt-8"
          >
            {/* deslop-ignore-next-line 12 */}
            <h2
              id="notifications-settings-title"
              className="mb-5 text-sm font-semibold text-balance"
            >
              {copy.notifications}
            </h2>
            <SettingRow
              label={copy.notificationsDesktop}
              description={copy.notificationsDesktopHint}
            >
              <Switch
                checked={notificationsEnabled.value}
                onCheckedChange={notificationsEnabled.select}
                ariaLabel={copy.notificationsDesktop}
              />
            </SettingRow>
          </section>

          <section
            aria-labelledby="telegram-settings-title"
            className="border-t pt-8"
          >
            {/* deslop-ignore-next-line 12 */}
            <h2
              id="telegram-settings-title"
              className="mb-5 text-sm font-semibold text-balance"
            >
              {copy.telegramAccount}
            </h2>
            {currentUser ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar
                    initials={currentUser.initials}
                    src={currentUser.avatarDataUrl}
                    className="size-12 text-sm"
                  />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm font-semibold">
                      {currentUser.displayName}
                    </strong>
                    {currentUser.username ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        @{currentUser.username}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={showConnectionForm}
                    onClick={() => setShowConnectionForm((visible) => !visible)}
                  >
                    {copy.reconnectTelegram}
                  </Button>
                  <StatefulButton
                    variant="outline"
                    size="sm"
                    state={logOutState}
                    loadingText={copy.loading}
                    successText={copy.loggedOut}
                    errorText={copy.failed}
                    icon={<SignOut />}
                    onClick={() => void handleLogOut()}
                    className={
                      confirmingLogOut
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-destructive/40 text-destructive hover:bg-destructive/10"
                    }
                  >
                    {confirmingLogOut ? copy.logOutConfirm : copy.logOut}
                  </StatefulButton>
                </div>
                {showConnectionForm ? (
                  <div className="mt-5">
                    <TelegramConnectionForm compact />
                  </div>
                ) : null}
              </>
            ) : (
              <TelegramConnectionForm compact />
            )}
          </section>

          <section
            aria-labelledby="agent-settings-title"
            className="border-t pt-8"
          >
            {/* deslop-ignore-next-line 12 */}
            <h2
              id="agent-settings-title"
              className="mb-5 text-sm font-semibold text-balance"
            >
              {copy.agentSettings}
            </h2>
            <AgentConfigurationForm />
          </section>
        </div>
      </div>
    </main>
  );
}
