import { motion } from "motion/react";
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
  EASE_OUT,
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
  // Drives the hold-to-confirm fill on the destructive button below.
  const [holding, setHolding] = useState(false);
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
          <h2 className="text-base font-semibold text-balance">
            {copy.deleteMessage}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
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
              variant="destructive"
              onClick={() => {
                const effectiveScope = canDeleteForEveryone ? scope : "me";
                if (single && messages) {
                  void deleteMessage(messages[0].id, effectiveScope);
                } else {
                  void deleteSelectedMessages(effectiveScope);
                }
                onClose();
              }}
              onPointerDown={() => setHolding(true)}
              onPointerUp={() => setHolding(false)}
              onPointerLeave={() => setHolding(false)}
              onPointerCancel={() => setHolding(false)}
              onBlur={() => setHolding(false)}
              className="relative overflow-hidden"
            >
              {/* Hold-to-confirm affordance: a fill sweeps the button while
                  the press is held (2s linear) and snaps back on release.
                  It gates nothing — a plain click or keyboard Enter still
                  confirms immediately; dragging off the button cancels. */}
              <motion.span
                aria-hidden
                initial={false}
                animate={{
                  clipPath: holding ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
                }}
                transition={
                  holding
                    ? { duration: 2, ease: "linear" }
                    : { duration: 0.2, ease: EASE_OUT }
                }
                className="absolute inset-0 bg-primary-foreground/20"
              />
              <span className="relative">{copy.deleteMessage}</span>
            </Button>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
