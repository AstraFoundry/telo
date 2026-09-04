import { useState } from "react";

import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
} from "shared/ui";

interface StartSecretChatDialogProps {
  readonly userId: string;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

export function StartSecretChatDialog({
  userId,
  open,
  onOpenChange,
}: StartSecretChatDialogProps) {
  const select = useChatStore((state) => state.select);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const chat = await window.telo.workspace.createSecretChat(userId);
      onOpenChange(false);
      await select(chat.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.startSecretChat}
        closeButtonLabel={copy.closeDialog}
      >
        <div className="flex flex-col gap-4 p-5">
          {/* deslop-ignore-next-line 12 */}
          <h2 className="text-base font-semibold">{copy.startSecretChat}</h2>
          <p className="text-sm text-muted-foreground">
            {copy.startSecretChatConfirm}
          </p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <CenterMorphModalClose>
              <Button type="button" variant="ghost">
                {copy.cancel}
              </Button>
            </CenterMorphModalClose>
            <Button type="button" disabled={busy} onClick={() => void start()}>
              {copy.startSecretChatAction}
            </Button>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
