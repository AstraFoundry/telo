import type { MessageDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
} from "shared/ui";

interface DeleteMessageDialogProps {
  /** The message pending deletion; null closes the dialog. */
  message: MessageDto | null;
  onClose(): void;
}

export function DeleteMessageDialog({
  message,
  onClose,
}: DeleteMessageDialogProps) {
  const deleteMessage = useChatStore((state) => state.deleteMessage);

  return (
    <CenterMorphModal
      open={message !== null}
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
            {copy.deleteMessageConfirm}
          </p>
          <div className="flex justify-end gap-2">
            <CenterMorphModalClose>
              <Button variant="ghost">{copy.cancel}</Button>
            </CenterMorphModalClose>
            <Button
              variant="primary"
              onClick={() => {
                if (message) void deleteMessage(message.id);
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
