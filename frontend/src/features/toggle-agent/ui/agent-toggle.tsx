import { Sparkle } from "@phosphor-icons/react";

import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import { Button, Tooltip } from "shared/ui";

export function AgentToggle() {
  const open = useAgentStore((state) => state.open);
  const toggle = useAgentStore((state) => state.toggle);
  const label = open ? copy.closeAgent : copy.openAgent;

  return (
    <Tooltip content={label} side="bottom">
      <Button
        size="icon"
        variant={open ? "secondary" : "ghost"}
        aria-label={label}
        aria-pressed={open}
        className="size-10"
        onClick={toggle}
      >
        <Sparkle weight={open ? "fill" : "regular"} />
      </Button>
    </Tooltip>
  );
}
