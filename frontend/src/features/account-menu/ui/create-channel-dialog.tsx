import { useState } from "react";

import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  ErrorRow,
  Input,
  StatefulButton,
} from "shared/ui";

interface CreateChannelDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

export function CreateChannelDialog({
  open,
  onOpenChange,
}: CreateChannelDialogProps) {
  const selectChat = useChatStore((state) => state.select);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const chat = await window.telo.workspace.createChannel({
        title,
        description,
      });
      onOpenChange(false);
      setTitle("");
      setDescription("");
      await selectChat(chat.id);
    } catch {
      setError(copy.createChatFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.newChannel}
        closeButtonLabel={copy.closeDialog}
        className="w-[min(92vw,420px)]"
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) void create();
          }}
        >
          <h2 className="pr-10 text-base font-semibold">{copy.newChannel}</h2>
          <Input
            label={copy.channelName}
            value={title}
            maxLength={128}
            onChange={setTitle}
            autoFocus
          />
          <Input
            label={copy.channelDescription}
            value={description}
            maxLength={255}
            onChange={setDescription}
          />
          <ErrorRow message={error} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {copy.cancel}
            </Button>
            <StatefulButton
              type="submit"
              state={busy ? "loading" : "idle"}
              disabled={!title.trim()}
            >
              {copy.createChannel}
            </StatefulButton>
          </div>
        </form>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
