import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, CenterMorphModal, CenterMorphModalContent } from "shared/ui";

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
  const forwardSelectedMessages = useChatStore(
    (state) => state.forwardSelectedMessages,
  );

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
            {chats.map((chat) => (
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
