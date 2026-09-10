import { useState } from "react";

import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  ErrorRow,
  Input,
  StatefulButton,
} from "shared/ui";

export interface EditNameDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * tdesktop's EditNameBox: first and last name, first name required. The
 * account carries only a display name, so the split at the first space is
 * the prefill; Telegram recomposes the pair server-side on save.
 *
 * The form mounts only while the modal is open (CenterMorphModalContent
 * unmounts its children on close), so field state initializes from the
 * current identity and every opening starts clean — no reset effect.
 */
export function EditNameDialog({ open, onOpenChange }: EditNameDialogProps) {
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.profileName}
        closeButtonLabel={copy.closeDialog}
        className="w-[min(92vw,420px)]"
      >
        <EditNameForm onClose={() => onOpenChange(false)} />
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

function EditNameForm({ onClose }: { onClose(): void }) {
  const currentUser = useTelegramStore((state) => state.currentUser);
  const updateProfileName = useTelegramStore(
    (state) => state.updateProfileName,
  );
  const [firstName, setFirstName] = useState(() => {
    const displayName = currentUser?.displayName ?? "";
    const splitAt = displayName.indexOf(" ");
    return splitAt === -1 ? displayName : displayName.slice(0, splitAt);
  });
  const [lastName, setLastName] = useState(() => {
    const displayName = currentUser?.displayName ?? "";
    const splitAt = displayName.indexOf(" ");
    return splitAt === -1 ? "" : displayName.slice(splitAt + 1).trim();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstNameMissing = firstName.trim() === "";

  const submit = async () => {
    if (firstNameMissing) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfileName({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      onClose();
    } catch (cause) {
      const detail = userFacingErrorDetail(cause);
      setError(
        detail
          ? `${copy.profileSaveFailed}: ${detail}`
          : copy.profileSaveFailed,
      );
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="pr-10 text-base font-semibold">{copy.profileName}</h2>
      <Input
        label={copy.contactFirstName}
        value={firstName}
        maxLength={64}
        onChange={setFirstName}
        error={firstNameMissing ? copy.firstNameRequired : undefined}
        required
        className="mt-4"
      />
      <Input
        label={copy.contactLastName}
        value={lastName}
        maxLength={64}
        onChange={setLastName}
        className="mt-3"
      />
      <ErrorRow message={error} className="mt-3" />
      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={onClose}
        >
          {copy.cancel}
        </Button>
        <StatefulButton
          type="submit"
          state={saving ? "loading" : "idle"}
          disabled={saving || firstNameMissing}
        >
          {copy.save}
        </StatefulButton>
      </div>
    </form>
  );
}
