import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import type { TelegramContactDto } from "../../../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  EASE_OUT,
  Input,
  StatefulButton,
} from "shared/ui";

export interface AddContactByPhoneDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  /** Fired with the imported contact so an open contact list can refetch. */
  onAdded?(contact: TelegramContactDto): void;
}

/**
 * tdesktop's AddContactBox: one name part is enough, the phone decides
 * (Telegram `importContacts`). A null result means the number is not
 * registered and the dialog swaps to the "not joined" retry state.
 */
export function AddContactByPhoneDialog({
  open,
  onOpenChange,
  onAdded,
}: AddContactByPhoneDialogProps) {
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.newContact}
        closeButtonLabel={copy.closeDialog}
      >
        {/* The form is a child of the modal content, which only mounts while
            the dialog is open, so every opening starts from a clean draft. */}
        <AddContactByPhoneForm
          onClose={() => onOpenChange(false)}
          onAdded={onAdded}
        />
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

function AddContactByPhoneForm({
  onClose,
  onAdded,
}: {
  onClose(): void;
  onAdded?(contact: TelegramContactDto): void;
}) {
  const select = useChatStore((state) => state.select);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [notJoined, setNotJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotionConfig() ?? false;

  // The not-joined verdict replaces the form inside the open dialog; an
  // occasional, state-indicating swap, so it crossfades instead of
  // teleporting (popLayout resizes the modal in one step).
  const swap = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: 0.14, ease: EASE_OUT },
  } as const;

  const hasName = Boolean(firstName.trim() || lastName.trim());
  // The adapter strips formatting; the gate counts raw digits only.
  const phoneDigits = phone.replace(/\D/g, "").length;
  const ready = hasName && phoneDigits >= 8;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const contact = await window.telo.workspace.addContactByPhone({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
      });
      if (!contact) {
        setNotJoined(true);
        return;
      }
      const chat = await window.telo.workspace.openPrivateChat(contact.id);
      onAdded?.(contact);
      onClose();
      await select(chat.id);
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
    <AnimatePresence mode="popLayout" initial={false}>
      {notJoined ? (
        <motion.div
          key="not-joined"
          {...swap}
          className="flex flex-col gap-4 p-5"
        >
          <h2 className="pr-10 text-base font-semibold">{copy.newContact}</h2>
          <p className="text-sm text-muted-foreground">
            {copy.contactNotJoined}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {copy.cancel}
            </Button>
            {/* Back to the form with the draft intact so a mistyped digit is
                fixed, not retyped. */}
            <Button type="button" onClick={() => setNotJoined(false)}>
              {copy.trySomeoneElse}
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.form
          key="form"
          {...swap}
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) void create();
          }}
        >
          <h2 className="pr-10 text-base font-semibold">{copy.newContact}</h2>
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
          <Input
            label={copy.peerPhone}
            value={phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            onChange={setPhone}
          />
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
        </motion.form>
      )}
    </AnimatePresence>
  );
}
