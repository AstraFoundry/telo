import { BookmarkSimple, GearSix, Plus } from "@phosphor-icons/react";
import { useState } from "react";

import { useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
  Tooltip,
} from "shared/ui";

interface AccountMenuProps {
  onOpenSettings(): void;
}

export function AccountMenu({ onOpenSettings }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const currentUser = useTelegramStore((state) => state.currentUser);
  const accounts = useTelegramStore((state) => state.accounts);
  const switchAccount = useTelegramStore((state) => state.switchAccount);
  const startAddingAccount = useTelegramStore(
    (state) => state.startAddingAccount,
  );
  const chats = useChatStore((state) => state.chats);
  const select = useChatStore((state) => state.select);

  if (!currentUser) return null;

  const showSavedMessages = () => {
    const savedMessages = chats.find((chat) => chat.kind === "saved");
    if (savedMessages) void select(savedMessages.id);
    setOpen(false);
  };

  const showSettings = () => {
    onOpenSettings();
    setOpen(false);
  };

  return (
    <MorphPopover open={open} onOpenChange={setOpen} className="w-full">
      <MorphPopoverTrigger>
        <Button
          variant="ghost"
          aria-label={copy.openAccountMenu}
          className="h-14 w-full justify-start rounded-none px-3"
        >
          <Avatar src={currentUser.avatarDataUrl} className="size-9" />
          <span className="min-w-0 text-left">
            <strong className="block truncate text-sm font-semibold">
              {currentUser.displayName}
            </strong>
            {currentUser.username ? (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                @{currentUser.username}
              </span>
            ) : null}
          </span>
        </Button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-60 p-1.5"
      >
        {/* The account strip sits above the first option, the way Telegram
            Desktop's main menu lists accounts above its menu items
            (`window_main_menu.cpp`, `settings_information.cpp:826-980`): one
            disc per account, the active one ringed, and a default plus disc
            as the add-account affordance. */}
        <div
          role="group"
          aria-label={copy.accounts}
          className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5"
        >
          {accounts.map((account) => (
            <Tooltip key={account.id} content={account.displayName}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={account.displayName}
                aria-current={account.active || undefined}
                onClick={() => {
                  if (!account.active) void switchAccount(account.id);
                  setOpen(false);
                }}
                className="relative size-10 rounded-full"
              >
                <Avatar
                  src={account.avatarDataUrl}
                  className={`size-8 ${
                    account.active
                      ? // tdesktop draws a 2px accent ring on the active
                        // account's 26px userpic; same cue, same place.
                        "ring-2 ring-primary"
                      : ""
                  }`}
                />
                {!account.active && account.unreadCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 py-0.5 text-[9px] leading-none text-primary-foreground tabular-nums"
                  >
                    {account.unreadCount > 99 ? "99+" : account.unreadCount}
                  </span>
                ) : null}
              </Button>
            </Tooltip>
          ))}
          <Tooltip content={copy.addAccount}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={copy.addAccount}
              onClick={() => {
                startAddingAccount();
                setOpen(false);
              }}
              className="size-10 rounded-full border border-dashed border-border text-muted-foreground"
            >
              <Plus aria-hidden="true" className="size-4" />
            </Button>
          </Tooltip>
        </div>
        <div aria-hidden="true" className="mx-1.5 mb-1.5 border-t" />
        <Button
          variant="ghost"
          onClick={showSavedMessages}
          className="h-10 w-full justify-start rounded-lg px-2.5"
        >
          <BookmarkSimple aria-hidden="true" className="size-4" />
          {copy.savedMessages}
        </Button>
        <Button
          variant="ghost"
          onClick={showSettings}
          className="h-10 w-full justify-start rounded-lg px-2.5"
        >
          <GearSix aria-hidden="true" className="size-4" />
          {copy.settings}
        </Button>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
