import { UserMinus } from "@phosphor-icons/react";
import { useState } from "react";

import { copy } from "shared/config/copy";
import { StatefulButton, type ButtonState } from "shared/ui";

export interface RemovePeerContactConfirmProps {
  readonly userId: string;
  /** Fired after the peer leaves the contact list so the panel can refetch. */
  onSaved?(): void;
  readonly className?: string;
}

/**
 * Two-step contact removal (Telegram `removeContacts`), arming like the
 * settings logout button: the first click arms, the second executes.
 */
export function RemovePeerContactConfirm({
  userId,
  onSaved,
  className,
}: RemovePeerContactConfirmProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ButtonState>("idle");

  const handle = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setState("loading");
    try {
      await window.telo.workspace.removePeerContact(userId);
      setState("success");
      onSaved?.();
    } catch {
      setState("error");
    }
  };

  return (
    <StatefulButton
      type="button"
      variant="ghost"
      state={state}
      loadingText={copy.loading}
      errorText={copy.failed}
      icon={<UserMinus aria-hidden="true" className="size-4" />}
      onClick={() => void handle()}
      // The panel's row geometry (SectionHeader, the Add row): 40px, 10px
      // radius, 8px inset — a full-bleed settings row would stick out here.
      className={`h-10 w-full justify-start gap-2 rounded-lg px-2 text-sm font-medium text-destructive hover:bg-destructive/10 ${
        confirming ? "bg-destructive/10" : ""
      } ${className ?? ""}`}
    >
      {confirming ? copy.removeContactConfirm : copy.removeContact}
    </StatefulButton>
  );
}
