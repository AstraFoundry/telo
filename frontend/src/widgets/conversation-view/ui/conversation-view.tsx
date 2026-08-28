import {
  ArrowBendUpLeft,
  ArrowFatLineRight,
  Checks,
  Copy,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useState, type CSSProperties } from "react";

import type {
  MessageDto,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { useMessageTextSize, useTimeFormat } from "entities/preferences";
import { MessageComposer } from "features/send-message";
import { AgentToggle } from "features/toggle-agent";
import { copy } from "shared/config/copy";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageScroller,
} from "shared/ui";

import { DeleteMessageDialog } from "./delete-message-dialog";
import { ForwardPickerDialog } from "./forward-picker-dialog";

// "system" defers to the locale's hour12 default, while 12h/24h pin it
// explicitly.
function time(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

function ConversationMessage({
  message,
  timeFormat,
  onForward,
  onDelete,
}: {
  message: MessageDto;
  timeFormat: TimeFormatPreference;
  onForward(message: MessageDto): void;
  onDelete(message: MessageDto): void;
}) {
  const startReply = useChatStore((state) => state.startReply);
  const startEdit = useChatStore((state) => state.startEdit);
  // The selection is snapshotted when the menu opens, not at render time: the
  // portal keeps its items mounted while closed, so render-time reads go stale.
  const [selection, setSelection] = useState("");

  return (
    <Message from={message.outgoing ? "user" : "assistant"}>
      <MessageContent>
        {!message.outgoing ? (
          <MessageHeader>{message.senderName}</MessageHeader>
        ) : null}
        <ContextMenu
          onOpenChange={(open) => {
            if (open) setSelection(window.getSelection()?.toString() ?? "");
          }}
        >
          <ContextMenuTrigger>
            <MessageBubble variant={message.outgoing ? "tint" : "soft"}>
              {/* Font size comes from the --message-font-size variable set on
                  the conversation column; 14px matches text-sm before the
                  preference resolves. */}
              <MessageBubbleContent className="text-[length:var(--message-font-size,14px)]">
                {message.replyTo ? (
                  <div className="mb-1 border-l-2 border-primary pl-2">
                    <div className="truncate font-medium text-primary">
                      {message.replyTo.senderName}
                    </div>
                    <div className="truncate text-foreground/70">
                      {message.replyTo.body}
                    </div>
                  </div>
                ) : null}
                {message.body}
              </MessageBubbleContent>
            </MessageBubble>
          </ContextMenuTrigger>
          <ContextMenuContent ariaLabel={copy.messageActions}>
            <ContextMenuItem onSelect={() => startReply(message)}>
              <ArrowBendUpLeft aria-hidden="true" className="size-4" />
              {copy.reply}
            </ContextMenuItem>
            {message.outgoing ? (
              <ContextMenuItem onSelect={() => startEdit(message)}>
                <PencilSimple aria-hidden="true" className="size-4" />
                {copy.editMessage}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              onSelect={() =>
                void navigator.clipboard?.writeText(selection || message.body)
              }
            >
              <Copy aria-hidden="true" className="size-4" />
              {selection ? copy.copySelectedText : copy.copyText}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onForward(message)}>
              <ArrowFatLineRight aria-hidden="true" className="size-4" />
              {copy.forward}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              tone="destructive"
              onSelect={() => onDelete(message)}
            >
              <Trash aria-hidden="true" className="size-4" />
              {copy.deleteMessage}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <MessageFooter className="text-foreground/70">
          {message.editedAt ? <span>{copy.edited}</span> : null}
          <time>{time(message.sentAt, timeFormat)}</time>
          {message.outgoing ? (
            <Checks weight={message.status === "read" ? "bold" : "regular"} />
          ) : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

export function ConversationView() {
  const chats = useChatStore((state) => state.chats);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const messages = useChatStore((state) => state.messages);
  const send = useChatStore((state) => state.send);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const { value: timeFormat } = useTimeFormat();
  const { value: textSize } = useMessageTextSize();
  const [forwardSource, setForwardSource] = useState<MessageDto | null>(null);
  const [deleteSource, setDeleteSource] = useState<MessageDto | null>(null);

  return (
    <main
      className="flex min-w-0 flex-col"
      style={{ "--message-font-size": `${textSize}px` } as CSSProperties}
    >
      <header className="flex h-14 items-center px-4 [app-region:drag]">
        <div className="min-w-0 flex-1">
          {/* deslop-ignore-next-line 12 */}
          <h1 className="truncate text-base font-semibold">
            {activeChat?.title ?? copy.loading}
          </h1>
        </div>
        <div className="flex gap-1 [app-region:no-drag]">
          <AgentToggle />
        </div>
      </header>
      <MessageScroller
        label={copy.conversation}
        className="min-h-0 flex-1"
        contentClassName="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-5"
      >
        {messages.map((message) => (
          <ConversationMessage
            key={message.id}
            message={message}
            timeFormat={timeFormat}
            onForward={setForwardSource}
            onDelete={setDeleteSource}
          />
        ))}
      </MessageScroller>
      <div className="px-5 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <MessageComposer disabled={!activeChatId} onSend={send} />
        </div>
      </div>
      <ForwardPickerDialog
        message={forwardSource}
        onClose={() => setForwardSource(null)}
      />
      <DeleteMessageDialog
        message={deleteSource}
        onClose={() => setDeleteSource(null)}
      />
    </main>
  );
}
