import { useId, useState } from "react";

import type { PeerProfileDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import {
  Avatar,
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  Input,
  StatefulButton,
  Switch,
} from "shared/ui";

export interface EditPeerContactDialogProps {
  readonly profile: PeerProfileDto;
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  /** Fired after the contact is saved so the profile panel can refetch. */
  onSaved?(): void;
}

/** tdesktop EditContactBox: the display title splits into first/last name. */
function splitDisplayTitle(title: string): [string, string] {
  const trimmed = title.trim();
  const space = trimmed.search(/\s/);
  if (space < 0) return [trimmed, ""];
  return [trimmed.slice(0, space), trimmed.slice(space).trim()];
}

/**
 * tdesktop's EditContactBox: add or rename a known peer as a contact
 * (Telegram `addContact`), with the phone-privacy exception offered when the
 * peer's profile sets `needPhonePrivacyException`.
 */
export function EditPeerContactDialog({
  profile,
  open,
  onOpenChange,
  onSaved,
}: EditPeerContactDialogProps) {
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.addToContacts}
        closeButtonLabel={copy.closeDialog}
      >
        {/* The form is a child of the modal content, which only mounts while
            the dialog is open, so every opening reprefills from the profile. */}
        <EditPeerContactForm
          profile={profile}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

function EditPeerContactForm({
  profile,
  onClose,
  onSaved,
}: {
  profile: PeerProfileDto;
  onClose(): void;
  onSaved?(): void;
}) {
  const shareId = useId();
  const shareHintId = useId();
  const [firstName, setFirstName] = useState(
    () => splitDisplayTitle(profile.title)[0],
  );
  const [lastName, setLastName] = useState(
    () => splitDisplayTitle(profile.title)[1],
  );
  // tdesktop checks "share my phone number" by default when Telegram asks
  // for the exception.
  const [sharePhone, setSharePhone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TDLib addContact requires a first name (1-64 characters).
  const ready = Boolean(firstName.trim());

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.telo.workspace.setPeerContact({
        userId: profile.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        sharePhoneNumber: profile.needPhonePrivacyException
          ? sharePhone
          : false,
      });
      onClose();
      onSaved?.();
    } catch (cause) {
      const detail = userFacingErrorDetail(cause);
      setError(
        detail ? `${copy.addContactFailed}: ${detail}` : copy.addContactFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) void save();
      }}
    >
      <h2 className="pr-10 text-base font-semibold">{copy.addToContacts}</h2>
      <div className="flex items-center gap-3">
        <Avatar
          src={profile.avatarDataUrl}
          pending={profile.avatarPending}
          placeholder={profile.avatarPlaceholder}
          className="size-10"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{profile.title}</p>
          {profile.phone || profile.username ? (
            <p className="truncate text-xs text-muted-foreground">
              {profile.phone ?? `@${profile.username}`}
            </p>
          ) : null}
        </div>
      </div>
      <Input
        label={copy.contactFirstName}
        value={firstName}
        maxLength={64}
        autoComplete="off"
        onChange={setFirstName}
      />
      <Input
        label={copy.contactLastName}
        value={lastName}
        maxLength={64}
        autoComplete="off"
        onChange={setLastName}
      />
      {profile.needPhonePrivacyException ? (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={shareId} className="text-sm font-medium">
              {copy.shareMyPhoneNumber}
            </label>
            <p id={shareHintId} className="text-xs text-muted-foreground">
              {copy.sharePhoneHint}
            </p>
          </div>
          <Switch
            id={shareId}
            describedBy={shareHintId}
            checked={sharePhone}
            disabled={busy}
            onCheckedChange={setSharePhone}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {copy.cancel}
        </Button>
        <StatefulButton
          type="submit"
          state={busy ? "loading" : "idle"}
          disabled={!ready}
        >
          {copy.save}
        </StatefulButton>
      </div>
    </form>
  );
}
