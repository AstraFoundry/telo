import { PushPin } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, EASE_OUT } from "shared/ui";

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
  // The strip is a full-width row that pushes the transcript down, so its
  // arrival and departure animate height, not just opacity: without them the
  // conversation jumps by the strip's full height when the last pin goes.
  return (
    <AnimatePresence initial={false}>
      {current ? (
        <PinnedStrip
          key="pinned-strip"
          current={current}
          index={index}
          count={pinned.length}
          onAdvance={() => {
            void requestJumpToMessage(chatId, current.id);
            if (pinned.length > 1) setIndex((index + 1) % pinned.length);
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}

function PinnedStrip({
  current,
  index,
  count,
  onAdvance,
}: {
  readonly current: MessageDto;
  readonly index: number;
  readonly count: number;
  readonly onAdvance: () => void;
}) {
  const reduce = useReducedMotionConfig();
  const media = current.media;
  const preview = current.body.trim()
    ? current.body
    : media && media.kind !== "webpage" && media.fileName
      ? media.fileName
      : "";

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        duration: reduce ? 0.12 : 0.18,
        ease: EASE_OUT,
        // Exit is the softer half: it only has to clear the row, while the
        // enter has to read as a strip arriving above the transcript.
        opacity: { duration: reduce ? 0.12 : 0.14 },
      }}
      className="overflow-hidden"
    >
      <Button
        variant="ghost"
        pressScale={1}
        aria-label={copy.pinnedMessages}
        onClick={onAdvance}
        className="h-11 w-full justify-start gap-2 rounded-none border-b border-border px-4"
      >
        <PushPin
          aria-hidden="true"
          weight="fill"
          className="size-4 shrink-0 text-primary"
        />
        {count > 1 ? (
          // Cycling the counter in place would swap the digits under the
          // reader; the key makes each pin's number a distinct element so the
          // change is legible rather than a silent mutation.
          <motion.span
            key={current.id}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.16, ease: EASE_OUT }}
            className="shrink-0 text-caption font-medium text-primary tabular-nums"
          >
            {index + 1}/{count}
          </motion.span>
        ) : null}
        {preview ? (
          <motion.span
            key={`${current.id}-preview`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.16, ease: EASE_OUT }}
            className="min-w-0 flex-1 truncate text-left text-sm font-normal"
          >
            {preview}
          </motion.span>
        ) : null}
      </Button>
    </motion.div>
  );
}
