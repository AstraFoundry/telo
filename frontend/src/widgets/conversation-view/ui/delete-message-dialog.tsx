import { useState } from "react";

import type {
  DeleteMessageScope,
  MessageDto,
} from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  RadioGroup,
  RadioGroupItem,
} from "shared/ui";

interface DeleteMessageDialogProps {
  /** The messages pending deletion; null closes the dialog. */
  messages: ReadonlyArray<MessageDto> | null;
  onClose(): void;
}

export function DeleteMessageDialog({
  messages,
  onClose,
}: DeleteMessageDialogProps) {
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const deleteSelectedMessages = useChatStore(
    (state) => state.deleteSelectedMessages,
  );
  // Telegram rule: "for everyone" exists only for one's own messages, so an
  // incoming message (or a mixed batch) deletes for this account only.
  const canDeleteForEveryone =
    (messages?.length ?? 0) > 0 &&
    (messages ?? []).every((message) => message.outgoing);
  // The default stays "everyone": that is the behavior the delete action had
  // before scopes existed (the production adapter always revoked).
  const [scope, setScope] = useState<DeleteMessageScope>("everyone");
  const [previousMessages, setPreviousMessages] = useState(messages);
  if (messages !== previousMessages) {
    setPreviousMessages(messages);
    setScope("everyone");
  }
  const single = messages?.length === 1;

  return (
    <CenterMorphModal
      open={messages !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={copy.deleteMessage}
        closeButtonLabel={copy.closeDialog}
      >
        <div className="flex flex-col gap-4 p-5">
          {/* deslop-ignore-next-line 12 */}
          <h2 className="text-base font-semibold">{copy.deleteMessage}</h2>
          <p className="text-sm text-muted-foreground">
            {single ? copy.deleteMessageConfirm : copy.deleteMessagesConfirm}
          </p>
          {canDeleteForEveryone ? (
            <RadioGroup
              value={scope}
              onValueChange={(value) => setScope(value as DeleteMessageScope)}
            >
              <RadioGroupItem value="everyone" label={copy.deleteForEveryone} />
              <RadioGroupItem value="me" label={copy.deleteForMe} />
            </RadioGroup>
          ) : null}
          <div className="flex justify-end gap-2">
            <CenterMorphModalClose>
              <Button variant="ghost">{copy.cancel}</Button>
            </CenterMorphModalClose>
            <Button
              variant="primary"
              onClick={() => {
                const effectiveScope = canDeleteForEveryone ? scope : "me";
                if (single && messages) {
                  void deleteMessage(messages[0].id, effectiveScope);
                } else {
                  void deleteSelectedMessages(effectiveScope);
                }
                onClose();
              }}
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              {copy.deleteMessage}
            </Button>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
