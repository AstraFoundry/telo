import type { AgentDeliveryMode } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { RadioGroup, RadioGroupItem } from "shared/ui";

interface DeliveryModeRadioProps {
  readonly value: AgentDeliveryMode;
  onValueChange(value: AgentDeliveryMode): void;
}

/**
 * The one consequential choice of an automation: whether the run's reply is
 * posted into the chat or parked in the composer draft. Draft is the global
 * default, so it is the preselected option and auto-send only ever ships
 * when it was explicitly picked here — never implied by an absent value.
 */
export function DeliveryModeRadio({
  value,
  onValueChange,
}: DeliveryModeRadioProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="px-1 text-sm font-medium text-foreground">
        {copy.delivery}
      </legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onValueChange(next as AgentDeliveryMode)}
      >
        <RadioGroupItem value="draft-only" label={copy.deliveryDraftOnly} />
        <RadioGroupItem value="auto-send" label={copy.deliveryAutoSend} />
      </RadioGroup>
    </fieldset>
  );
}
