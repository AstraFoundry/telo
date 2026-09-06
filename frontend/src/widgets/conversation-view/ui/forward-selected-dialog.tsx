import { useEffect, useMemo } from "react";

import { chatsForPicker, displayChatTitle, useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
} from "shared/ui";

interface ForwardSelectedDialogProps {
  /** Whether the picker is open; the selection itself lives in the store. */
  open: boolean;
  onClose(): void;
}

// Batch forward picks one target chat, then loops the per-message forward
// contract over the selection (attribution options are the forward track's
// own item, not this dialog's). The row layout mirrors the single-message
// forward picker, which another workstream owns and cannot be shared yet.
export function ForwardSelectedDialog({
  open,
  onClose,
}: ForwardSelectedDialogProps) {
  const chats = useChatStore((state) => state.chats);
  const includeSavedMessages = useChatStore(
    (state) => state.includeSavedMessages,
  );
  const forwardSelectedMessages = useChatStore(
    (state) => state.forwardSelectedMessages,
  );
  const visible = useMemo(() => chatsForPicker(chats, ""), [chats]);

  useEffect(() => {
    if (!open) return;
    void includeSavedMessages();
  }, [open, includeSavedMessages]);

  return (
    <CenterMorphModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={copy.forwardTo}
        closeButtonLabel={copy.closeDialog}
      >
        <div className="flex max-h-[60vh] flex-col p-3">
          {/* deslop-ignore-next-line 12 */}
          <h2 className="px-2.5 pb-2 pt-1 text-base font-semibold">
            {copy.forwardTo}
          </h2>
          <div className="min-h-0 overflow-y-auto">
            {visible.map((chat) => (
              <Button
                key={chat.id}
                variant="ghost"
                onClick={() => {
                  void forwardSelectedMessages(chat.id);
                  onClose();
                }}
                /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
                className="h-auto w-full justify-start rounded-xl px-2.5 py-2"
              >
                <Avatar
                  src={chat.avatarDataUrl}
                  pending={chat.avatarPending}
                  mark={chat.kind === "saved" ? "saved" : undefined}
                  placeholder={chat.avatarPlaceholder}
                  className="size-10"
                />
                <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                  {displayChatTitle(chat)}
                </span>
              </Button>
            ))}
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
