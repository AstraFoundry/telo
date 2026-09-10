import { useState } from "react";

import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  ErrorRow,
  Input,
} from "shared/ui";

import {
  sendAtFromLocalInput,
  toLocalInputValue,
} from "../model/scheduled-time";

export interface ScheduleMessageDialogProps {
  readonly open: boolean;
  /** Unix seconds of the preselected slot, computed by the opener. */
  readonly defaultSendAt: number;
  onClose(): void;
  /** Receives unix seconds of the chosen delivery time. */
  onSchedule(sendAt: number): void;
}

/**
 * tdesktop's "Schedule message" picker (the send button's long-press menu),
 * reduced to a native datetime field. The opener passes `defaultSendAt` —
 * one hour out, like tdesktop preselecting a near-future slot — so this
 * component stays pure during render.
 */
export function ScheduleMessageDialog({
  open,
  defaultSendAt,
  onClose,
  onSchedule,
}: ScheduleMessageDialogProps) {
  const [wasOpen, setWasOpen] = useState(open);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Each open starts a fresh pick: the default and the error of the previous
  // scheduling attempt never bleed into the next one.
  if (open !== wasOpen) {
    setWasOpen(open);
    setValue(open ? toLocalInputValue(new Date(defaultSendAt * 1000)) : "");
    setError(null);
  }

  const submit = () => {
    const sendAt = sendAtFromLocalInput(value);
    if (sendAt === null) {
      setError(copy.scheduleTimeInvalid);
      return;
    }
    if (sendAt * 1000 <= Date.now()) {
      setError(copy.scheduleTimePast);
      return;
    }
    onSchedule(sendAt);
    onClose();
  };

  return (
    <CenterMorphModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={copy.scheduleMessage}
        closeButtonLabel={copy.closeDialog}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {/* deslop-ignore-next-line 12 */}
          <h2 className="text-base font-semibold">{copy.scheduleMessage}</h2>
          <Input
            label={copy.scheduleTime}
            type="datetime-local"
            value={value}
            onChange={(next) => {
              setValue(next);
              if (error) setError(null);
            }}
            required
          />
          <ErrorRow message={error} />
          <div className="flex justify-end gap-2">
            <CenterMorphModalClose>
              <Button type="button" variant="ghost">
                {copy.cancel}
              </Button>
            </CenterMorphModalClose>
            <Button type="submit" variant="primary">
              {copy.scheduleConfirm}
            </Button>
          </div>
        </form>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
