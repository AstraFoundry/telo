import { PushPin } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button } from "shared/ui";

interface PinnedMessageBarProps {
  readonly chatId: string;
}

// Nicegram keeps this strip for pinned messages only — connection copy lives
// in the chat-list title, not here.
export function PinnedMessageBar({ chatId }: PinnedMessageBarProps) {
  const requestJumpToMessage = useChatStore(
    (state) => state.requestJumpToMessage,
  );
  const [loadedChatId, setLoadedChatId] = useState(chatId);
  const [pinned, setPinned] = useState<ReadonlyArray<MessageDto>>([]);
  const [index, setIndex] = useState(0);
  if (loadedChatId !== chatId) {
    setLoadedChatId(chatId);
    setPinned([]);
    setIndex(0);
  }

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      window.telo.workspace.listPinnedMessages(chatId).then(
        (messages) => {
          if (!cancelled) {
            setPinned(messages);
            setIndex(0);
          }
        },
        (error: unknown) => {
          console.error("Pinned messages failed", error);
        },
      );
    void load();
    const unsubscribe = window.telo.workspace.onEvent((event) => {
      if (event.type === "pinned-messages" && event.chatId === chatId) {
        void load();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [chatId]);

  const current = pinned[index];
  if (!current) return null;

  const media = current.media;
  const preview = current.body.trim()
    ? current.body
    : media && media.kind !== "webpage" && media.fileName
      ? media.fileName
      : "";
  const count = pinned.length;

  return (
    <Button
      variant="ghost"
      pressScale={1}
      aria-label={copy.pinnedMessages}
      onClick={() => {
        void requestJumpToMessage(chatId, current.id);
        if (count > 1) setIndex((index + 1) % count);
      }}
      className="h-11 w-full justify-start gap-2 rounded-none border-b border-border px-4"
    >
      <PushPin
        aria-hidden="true"
        weight="fill"
        className="size-4 shrink-0 text-primary"
      />
      {count > 1 ? (
        <span className="shrink-0 text-caption font-medium text-primary tabular-nums">
          {index + 1}/{count}
        </span>
      ) : null}
      {preview ? (
        <span className="min-w-0 flex-1 truncate text-left text-sm font-normal">
          {preview}
        </span>
      ) : null}
    </Button>
  );
}
