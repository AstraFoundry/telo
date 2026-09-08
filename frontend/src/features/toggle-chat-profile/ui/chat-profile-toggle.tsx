import { Info } from "@phosphor-icons/react";

import { useChatProfileStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, Tooltip } from "shared/ui";

// Header toggle for the chat profile panel, mirroring the agent toggle:
// 40px hit area, fill icon marks the open state, no motion.
export function ChatProfileToggle() {
  const open = useChatProfileStore((state) => state.open);
  const openPanel = useChatProfileStore((state) => state.openPanel);
  const closePanel = useChatProfileStore((state) => state.closePanel);

  return (
    <Tooltip content={copy.chatProfile} side="bottom">
      <Button
        size="icon"
        variant={open ? "secondary" : "ghost"}
        aria-label={copy.chatProfile}
        aria-pressed={open}
        className="size-10"
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <Info weight={open ? "fill" : "regular"} />
      </Button>
    </Tooltip>
  );
}
