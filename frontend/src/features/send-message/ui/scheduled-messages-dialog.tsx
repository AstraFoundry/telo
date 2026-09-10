import { Trash } from "@phosphor-icons/react";
import { useState } from "react";

import type { MessageDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  ErrorRow,
} from "shared/ui";

import { formatScheduledAt } from "../model/scheduled-time";

export interface ScheduledMessagesDialogProps {
  readonly chatId: string;
  /** The chat's scheduled messages, soonest delivery first. */
  readonly messages: ReadonlyArray<MessageDto>;
  readonly open: boolean;
  onClose(): void;
  /** Reloads the list after a delete lands. */
  onChanged(): void;
}

/**
 * The chat's scheduled list, opened from the composer bar. Rows mirror
 * tdesktop's scheduled view: body preview plus the delivery stamp, with a
 * delete per row (TDLib `deleteMessages` covers scheduled ids).
 */
export function ScheduledMessagesDialog({
  chatId,
  messages,
  open,
  onClose,
  onChanged,
}: ScheduledMessagesDialogProps) {
  const [error, setError] = useState<string | null>(null);

  const remove = async (messageId: string) => {
    try {
      await window.telo.workspace.deleteMessage({ chatId, messageId });
      setError(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <CenterMorphModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={copy.scheduledMessages}
        closeButtonLabel={copy.closeDialog}
      >
        <div className="flex max-h-[60vh] flex-col p-3">
          {/* deslop-ignore-next-line 12 */}
          <h2 className="px-2.5 pb-2 pt-1 text-base font-semibold">
            {copy.scheduledMessages}
          </h2>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {messages.map((message) => (
              <li
                key={message.id}
                className="flex items-center gap-2 rounded-xl px-2.5 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {message.body}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatScheduledAt(message.scheduledAt ?? message.sentAt)}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${copy.deleteScheduledMessage}: ${message.body}`}
                  className="size-10 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => void remove(message.id)}
                >
                  <Trash aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
            {messages.length === 0 ? (
              <li className="grid place-items-center px-3 py-6 text-sm text-muted-foreground">
                {copy.noScheduledMessages}
              </li>
            ) : null}
          </ul>
          <ErrorRow message={error} className="px-2.5" />
          <div className="flex justify-end gap-2 border-t px-2.5 pb-1 pt-3">
            <CenterMorphModalClose>
              <Button type="button" variant="ghost">
                {copy.cancel}
              </Button>
            </CenterMorphModalClose>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
