import { ArrowClockwise } from "@phosphor-icons/react";

import { copy } from "shared/config/copy";
import { Button } from "shared/ui";

interface RunFailedRowProps {
  onRetry(): void;
}

/**
 * The transcript's only word about a failed run. It sits where the reply
 * would have been and offers the one thing the reader can do about it; the
 * failure's cause is logged main-side and never rendered here.
 */
export function RunFailedRow({ onRetry }: RunFailedRowProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-1 text-xs text-muted-foreground"
    >
      <span>{copy.agentRunFailed}</span>
      <Button variant="ghost" size="sm" className="px-2.5" onClick={onRetry}>
        <ArrowClockwise aria-hidden="true" className="size-3.5" />
        {copy.agentRetry}
      </Button>
    </div>
  );
}
