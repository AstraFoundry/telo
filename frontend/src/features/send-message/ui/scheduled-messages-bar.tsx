import { CalendarBlank } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { Button, EASE_OUT } from "shared/ui";

import { formatScheduledAt } from "../model/scheduled-time";
import { ScheduledMessagesDialog } from "./scheduled-messages-dialog";

interface ScheduledMessagesBarProps {
  readonly chatId: string;
}

/**
 * Entry point to the chat's scheduled messages, drawn above the composer
 * while any exist — tdesktop surfaces the same strip in the composer area.
 * The list reloads on the adapter's `scheduled-messages` event, which both
 * scheduling and deleting emit.
 */
export function ScheduledMessagesBar({ chatId }: ScheduledMessagesBarProps) {
  const reduce = useReducedMotionConfig();
  const [loadedChatId, setLoadedChatId] = useState(chatId);
  const [messages, setMessages] = useState<ReadonlyArray<MessageDto>>([]);
  const [open, setOpen] = useState(false);
  if (loadedChatId !== chatId) {
    setLoadedChatId(chatId);
    setMessages([]);
    setOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      window.telo.workspace.listScheduledMessages(chatId).then(
        (list) => {
          if (!cancelled) setMessages(list);
        },
        (error: unknown) => {
          console.error("Scheduled messages failed", error);
        },
      );
    void load();
    const unsubscribe = window.telo.workspace.onEvent((event) => {
      if (event.type === "scheduled-messages" && event.chatId === chatId) {
        void load();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [chatId]);

  const next = messages[0];
  // The strip pushes the composer down, so like the pin strip it animates
  // height and opacity: a bare fade would jump the composer by the row's
  // height when the last scheduled message goes.
  return (
    <>
      <AnimatePresence initial={false}>
        {next ? (
          <motion.div
            key="scheduled-strip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: reduce ? 0.12 : 0.18,
              ease: EASE_OUT,
              opacity: { duration: reduce ? 0.12 : 0.14 },
            }}
            className="overflow-hidden"
          >
            <Button
              variant="ghost"
              pressScale={1}
              aria-label={copy.scheduledMessages}
              onClick={() => setOpen(true)}
              className="h-11 w-full justify-start gap-2 rounded-xl border border-border px-4"
            >
              <CalendarBlank
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              <span className="shrink-0 text-sm font-medium text-primary">
                {copy.scheduledMessages}
              </span>
              <span className="min-w-0 flex-1 truncate text-left text-sm font-normal text-muted-foreground">
                {formatScheduledAt(next.scheduledAt ?? next.sentAt)}
                {messages.length > 1 ? ` · ${messages.length}` : ""}
              </span>
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ScheduledMessagesDialog
        chatId={chatId}
        messages={messages}
        open={open}
        onClose={() => setOpen(false)}
        onChanged={() => {
          void window.telo.workspace
            .listScheduledMessages(chatId)
            .then(setMessages);
        }}
      />
    </>
  );
}
