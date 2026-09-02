import { SignOut } from "@phosphor-icons/react";
import { useState } from "react";

import { useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { TelegramConnectionForm } from "features/connect-telegram";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  SettingsGroup,
  SettingsRow,
  StatefulButton,
  type ButtonState,
} from "shared/ui";

const CONNECTION_COPY: Record<
  "offline" | "synchronizing" | "connected",
  string
> = {
  offline: copy.connectionIdle,
  synchronizing: copy.connectionConnecting,
  connected: copy.connectionReady,
};

interface AccountSectionProps {
  onLoggedOut?(): void;
}

export function AccountSection({ onLoggedOut }: AccountSectionProps) {
  const currentUser = useTelegramStore((state) => state.currentUser);
  const logout = useTelegramStore((state) => state.logout);
  const connectionState = useChatStore((state) => state.connectionState);
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

  if (!currentUser) {
    return (
      <SettingsGroup description={copy.connectionIdle}>
        <div className="p-4">
          <TelegramConnectionForm compact />
        </div>
      </SettingsGroup>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identity cover. Avatar, name and the stable handle - the same three
          things every Telegram client leads its settings with. */}
      <SettingsGroup>
        <div className="flex items-center gap-4 p-4">
          <Avatar
            src={currentUser.avatarDataUrl}
            pending={false}
            className="size-14"
          />
          <div className="min-w-0">
            <strong className="block truncate text-base font-semibold">
              {currentUser.displayName}
            </strong>
            {currentUser.username ? (
              <span className="block truncate text-sm text-muted-foreground">
                @{currentUser.username}
              </span>
            ) : null}
          </div>
        </div>
        <SettingsRow
          label={copy.accountConnection}
          value={CONNECTION_COPY[connectionState]}
        >
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showConnectionForm}
            onClick={() => setShowConnectionForm((visible) => !visible)}
          >
            {copy.reconnectTelegram}
          </Button>
        </SettingsRow>
        {showConnectionForm ? (
          <div className="p-4">
            <TelegramConnectionForm compact />
          </div>
        ) : null}
      </SettingsGroup>

      {/* Destructive action, last and alone: nothing below it to mis-click.
          The row is the button - a row labelled "Log out" wrapping a button
          labelled "Log out" would say it twice. */}
      <SettingsGroup>
        <StatefulButton
          variant="ghost"
          state={logOutState}
          loadingText={copy.loading}
          successText={copy.loggedOut}
          errorText={copy.failed}
          icon={<SignOut />}
          onClick={() => void handleLogOut()}
          className={`h-auto w-full justify-start rounded-none px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 ${
            confirmingLogOut ? "bg-destructive/10" : ""
          }`}
        >
          {confirmingLogOut ? copy.logOutConfirm : copy.logOut}
        </StatefulButton>
      </SettingsGroup>
    </div>
  );
}
