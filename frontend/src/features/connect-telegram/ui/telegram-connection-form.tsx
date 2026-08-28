import { useConnectionForm } from "../model/use-connection-form";
import { ConnectionStepContent } from "./connection-steps";

interface TelegramConnectionFormProps {
  compact?: boolean;
}

/** Inline multi-step Telegram sign-in (Settings). */
export function TelegramConnectionForm({
  compact = false,
}: TelegramConnectionFormProps) {
  const form = useConnectionForm();
  return <ConnectionStepContent form={form} compact={compact} />;
}
