import { useEffect, useId, useRef, useState } from "react";

import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";

/** tdesktop's bio limit (`kMaxBioLength`). */
const MAX_BIO_LENGTH = 70;
const AUTOSAVE_DELAY_MS = 1000;

/** The wire format is single-line; soft wraps replace the newlines. */
function collapseBio(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").trim();
}

/**
 * tdesktop's SetupBio: the bio saves itself a beat after the last keystroke,
 * with the remaining-character budget counting down beside the hint. The
 * editor owns the draft; a server-side change only lands when it is not the
 * echo of the draft just saved.
 */
export function EditBioField() {
  const id = useId();
  const storeBio = useTelegramStore((state) => state.currentUser?.bio ?? null);
  const updateBio = useTelegramStore((state) => state.updateBio);
  const [draft, setDraft] = useState(storeBio ?? "");
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef(collapseBio(storeBio ?? ""));

  // A "current-user" refresh (another client, or the save's own echo) adopts
  // the server bio unless it merely confirms what this field already sent.
  useEffect(() => {
    const incoming = storeBio ?? "";
    if (collapseBio(incoming) === lastSaved.current) return;
    lastSaved.current = collapseBio(incoming);
    setDraft(incoming);
  }, [storeBio]);

  useEffect(() => {
    const bio = collapseBio(draft);
    if (bio === lastSaved.current) return;
    const timer = setTimeout(() => {
      lastSaved.current = bio;
      setError(null);
      updateBio(bio).catch((cause: unknown) => {
        const detail = userFacingErrorDetail(cause);
        setError(
          detail
            ? `${copy.profileSaveFailed}: ${detail}`
            : copy.profileSaveFailed,
        );
      });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, updateBio]);

  const remaining = MAX_BIO_LENGTH - draft.length;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <label htmlFor={id} className="text-sm font-medium">
        {copy.peerBio}
      </label>
      <textarea
        id={id}
        value={draft}
        maxLength={MAX_BIO_LENGTH}
        rows={2}
        aria-describedby={`${id}-hint`}
        onChange={(event) => setDraft(event.target.value)}
        className="resize-none rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-base leading-6 text-foreground outline-none transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:ring-2 focus:ring-ring/40"
      />
      <div className="flex items-baseline justify-between gap-4">
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {copy.bioHint}
        </p>
        <span
          className={`text-caption tabular-nums ${
            remaining === 0 ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {remaining}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
