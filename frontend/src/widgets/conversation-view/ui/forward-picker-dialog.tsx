import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, CenterMorphModal, CenterMorphModalContent } from "shared/ui";

interface ForwardPickerDialogProps {
  /** The message being forwarded; null closes the dialog. */
  message: MessageDto | null;
  onClose(): void;
}

// Telegram allows forwarding back into the source chat, so the list keeps
// every conversation. Rows reuse the sidebar chat-row visual (initials avatar
// + title); that composition is not a new primitive.
export function ForwardPickerDialog({
  message,
  onClose,
}: ForwardPickerDialogProps) {
  const chats = useChatStore((state) => state.chats);
  const forwardMessage = useChatStore((state) => state.forwardMessage);

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
          <div className="min-h-0 overflow-y-auto">
            {chats.map((chat) => (
              <Button
                key={chat.id}
                variant="ghost"
                onClick={() => {
                  if (message) void forwardMessage(message.id, chat.id);
                  onClose();
                }}
                /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
                className="h-auto w-full justify-start rounded-xl px-2.5 py-2"
              >
                {/* deslop-ignore-next-line 19 */}
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">
                  {chat.initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                  {chat.title}
                </span>
              </Button>
            ))}
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
