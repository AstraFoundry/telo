import { BookmarkSimple, GearSix } from "@phosphor-icons/react";
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
} from "shared/ui";

interface AccountMenuProps {
  onOpenSettings(): void;
}

export function AccountMenu({ onOpenSettings }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const currentUser = useTelegramStore((state) => state.currentUser);
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
