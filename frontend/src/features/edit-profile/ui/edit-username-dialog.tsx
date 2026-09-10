import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { UsernameAvailability } from "../../../../../contracts/src/ipc";
import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalContent,
  EASE_OUT,
  ErrorRow,
  Input,
  StatefulButton,
} from "shared/ui";

export interface EditUsernameDialogProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
}

/** tdesktop's username rules: a-z, 0-9 and underscores, at least 5 chars. */
const USERNAME_PATTERN = /^[a-z0-9_]{5,}$/;
const AVAILABILITY_DEBOUNCE_MS = 500;

/** A check result is only valid for the candidate that produced it. */
interface AvailabilityResult {
  readonly candidate: string;
  readonly state: UsernameAvailability;
}

type Availability = UsernameAvailability | "checking" | "invalid";

const AVAILABILITY_COPY: Record<
  Availability,
  { text: string; className: string }
> = {
  available: { text: copy.usernameAvailable, className: "text-primary" },
  taken: { text: copy.usernameTaken, className: "text-destructive" },
  checking: {
    text: copy.usernameChecking,
    className: "text-muted-foreground",
  },
  invalid: { text: copy.usernameInvalid, className: "text-muted-foreground" },
  unknown: { text: "", className: "text-muted-foreground" },
};

/**
 * tdesktop's UsernamesBox reduced to the single personal username: a live
 * availability check under the field, save only for a name known to be
 * available (or the one already held), and an empty field removes it.
 *
 * The form mounts only while the modal is open (CenterMorphModalContent
 * unmounts its children on close), so the field initializes from the current
 * username and every opening starts clean — no reset effect.
 */
export function EditUsernameDialog({
  open,
  onOpenChange,
}: EditUsernameDialogProps) {
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={copy.peerUsername}
        closeButtonLabel={copy.closeDialog}
        className="w-[min(92vw,420px)]"
      >
        <EditUsernameForm onClose={() => onOpenChange(false)} />
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

function EditUsernameForm({ onClose }: { onClose(): void }) {
  const currentUser = useTelegramStore((state) => state.currentUser);
  const setUsername = useTelegramStore((state) => state.setUsername);
  const [value, setValue] = useState(() => currentUser?.username ?? "");
  const [result, setResult] = useState<AvailabilityResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const reduce = useReducedMotionConfig() ?? false;

  const current = currentUser?.username ?? "";
  const candidate = value.trim().toLowerCase();
  const unchanged = candidate === current;
  // Under the minimum or outside the charset there is nothing to ask
  // Telegram; the field explains the rules instead.
  const checkable =
    candidate !== "" && !unchanged && USERNAME_PATTERN.test(candidate);

  useEffect(() => {
    if (!checkable) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      window.telo.workspace
        .checkUsernameAvailability(candidate)
        .then((state) => {
          if (id === requestId.current) setResult({ candidate, state });
        })
        .catch(() => {
          if (id === requestId.current) {
            setResult({ candidate, state: "unknown" });
          }
        });
    }, AVAILABILITY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [checkable, candidate]);

  // The displayed state is derived, never stored: empty/unchanged shows
  // nothing, a rule violation shows the rules, a stale result for an older
  // candidate reads as "checking" until its own answer lands.
  const checked: Availability | null =
    candidate === "" || unchanged
      ? null
      : !USERNAME_PATTERN.test(candidate)
        ? "invalid"
        : result !== null && result.candidate === candidate
          ? result.state
          : "checking";

  const canSave =
    !saving &&
    checked !== "checking" &&
    (candidate === "" || unchanged || checked === "available");

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await setUsername(candidate);
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

  const status = checked === null ? null : AVAILABILITY_COPY[checked];

  return (
    <form
      className="flex flex-col p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="pr-10 text-base font-semibold">{copy.peerUsername}</h2>
      <Input
        label={copy.peerUsername}
        value={value}
        maxLength={32}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(next) => setValue(next.toLowerCase())}
        className="mt-4"
      />
      {/* Rare edit, state indication: the verdict swaps under the field, so
          it crossfades instead of teleporting. The line height is reserved,
          so the swap never shifts the form. */}
      <p aria-live="polite" className="mt-1.5 min-h-4 px-1 text-xs">
        <AnimatePresence mode="popLayout" initial={false}>
          {status ? (
            <motion.span
              key={checked}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -2 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
              className={`block ${status.className}`}
            >
              {status.text}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </p>
      <ErrorRow message={error} className="mt-1" />
      <div className="mt-3 flex justify-end gap-2">
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
          disabled={!canSave}
        >
          {copy.save}
        </StatefulButton>
      </div>
    </form>
  );
}
