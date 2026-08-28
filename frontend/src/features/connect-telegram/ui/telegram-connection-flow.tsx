import { MorphingModal } from "shared/ui";

import { useConnectionForm } from "../model/use-connection-form";
import { ConnectionStepContent } from "./connection-steps";

interface TelegramConnectionFlowProps {
  open: boolean;
  onClose(): void;
}

/**
 * Modal multi-step Telegram sign-in (onboarding). The panel morphs its height
 * and blur cross-fades between steps; the first view does not animate.
 */
export function TelegramConnectionFlow({
  open,
  onClose,
}: TelegramConnectionFlowProps) {
  const form = useConnectionForm();
  return (
    <MorphingModal
      viewId={open ? form.viewId : null}
      onClose={onClose}
      placement="center"
    >
      <ConnectionStepContent form={form} />
    </MorphingModal>
  );
}
