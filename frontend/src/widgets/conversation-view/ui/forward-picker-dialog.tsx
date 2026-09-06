import { Check, CircleNotch } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { chatsForPicker, displayChatTitle, useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Input,
  Switch,
} from "shared/ui";

interface ForwardPickerDialogProps {
  /** The message being forwarded; null closes the dialog. */
  message: MessageDto | null;
  onClose(): void;
}

// The picker filters the already-loaded chat list by display title (Saved
// Messages, not the TDLib self-chat name). The sidebar's server search stays
// scoped to navigation. Telegram allows forwarding back into the source
// chat, so the list keeps every conversation. Rows reuse the sidebar chat-row
// visual (avatar + title) plus a selection indicator: a forward can target
// several chats at once.
export function ForwardPickerDialog({
  message,
  onClose,
}: ForwardPickerDialogProps) {
  const chats = useChatStore((state) => state.chats);
  const forwardMessage = useChatStore((state) => state.forwardMessage);
  const includeSavedMessages = useChatStore(
    (state) => state.includeSavedMessages,
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [hideSender, setHideSender] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    void includeSavedMessages();
  }, [message, includeSavedMessages]);

  // Each forwarded message gets a fresh picker: selection, query, and the
  // toggle reset when the dialog reopens for another message.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (message && message.id !== openFor) {
    setOpenFor(message.id);
    setQuery("");
    setSelected([]);
    setHideSender(false);
    setSending(false);
    setError(null);
  }

  const visible = useMemo(() => chatsForPicker(chats, query), [chats, query]);

  const toggle = (chatId: string) => {
    setSelected((current) =>
      current.includes(chatId)
        ? current.filter((id) => id !== chatId)
        : [...current, chatId],
    );
  };

  const forward = async () => {
    if (!message || selected.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      // One forward per target keeps the single-message contract; the batch
      // helper is this loop, mirroring the store's selected-messages forward.
      for (const toChatId of selected) {
        await forwardMessage(message.id, toChatId, { hideSender });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <CenterMorphModal
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
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
          <div className="px-2.5 pb-2">
            <Input
              value={query}
              onChange={setQuery}
              placeholder={copy.searchChats}
              aria-label={copy.searchChats}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((chat) => {
              const picked = selected.includes(chat.id);
              return (
                <Button
                  key={chat.id}
                  variant="ghost"
                  aria-pressed={picked}
                  onClick={() => toggle(chat.id)}
                  /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
                  className="h-auto w-full justify-start rounded-xl px-2.5 py-2"
                >
                  <Avatar
                    src={chat.avatarDataUrl}
                    pending={chat.avatarPending}
                    mark={chat.kind === "saved" ? "saved" : undefined}
                    placeholder={chat.avatarPlaceholder}
                    className="size-10 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                    {displayChatTitle(chat)}
                  </span>
                  {/* Selection indicator: static color change, no motion —
                      forwarding is a routine action. */}
                  <span
                    aria-hidden="true"
                    className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
                      picked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {picked ? <Check className="size-3" weight="bold" /> : null}
                  </span>
                </Button>
              );
            })}
            {!visible.length ? (
              <div className="grid place-items-center px-3 py-6 text-center text-sm text-muted-foreground">
                {copy.noChats}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-t px-2.5 pb-1 pt-3">
            <Switch
              checked={hideSender}
              onCheckedChange={setHideSender}
              label={copy.forwardHideSender}
              ariaLabel={copy.forwardHideSender}
              className="min-w-0 flex-1"
            />
            <Button
              onClick={() => void forward()}
              disabled={selected.length === 0 || sending}
            >
              {sending ? (
                <CircleNotch
                  aria-hidden="true"
                  className="size-4 motion-safe:animate-spin"
                />
              ) : null}
              {copy.forward}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="px-2.5 pt-1 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
