import { Lock } from "@phosphor-icons/react";
import { useState } from "react";

import { copy } from "shared/config/copy";
import { ContextMenuItem } from "shared/ui";

import { StartSecretChatDialog } from "./start-secret-chat-dialog";

interface StartSecretChatMenuItemProps {
  readonly userId: string;
}

export function StartSecretChatMenuItem({
  userId,
}: StartSecretChatMenuItemProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ContextMenuItem onSelect={() => setOpen(true)}>
        <Lock aria-hidden="true" className="size-4" />
        {copy.startSecretChat}
      </ContextMenuItem>
      <StartSecretChatDialog
        userId={userId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
