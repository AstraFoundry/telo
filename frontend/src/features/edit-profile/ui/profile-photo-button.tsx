import { Camera } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { useTelegramStore } from "entities/telegram";
import { copy } from "shared/config/copy";
import { userFacingErrorDetail } from "shared/lib/user-facing-error";
import { Avatar, Tooltip } from "shared/ui";

/**
 * The identity cover's avatar doubles as the photo picker, the way tdesktop's
 * My Profile puts the camera badge on the photo itself.
 */
export function ProfilePhotoButton() {
  const currentUser = useTelegramStore((state) => state.currentUser);
  const setProfilePhoto = useTelegramStore((state) => state.setProfilePhoto);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!currentUser) return null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await setProfilePhoto(file);
    } catch (cause) {
      const detail = userFacingErrorDetail(cause);
      setError(
        detail
          ? `${copy.profileSaveFailed}: ${detail}`
          : copy.profileSaveFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <Tooltip content={copy.changeProfilePhoto}>
        <button
          type="button"
          aria-label={copy.changeProfilePhoto}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          /* deslop-ignore-next-line 19 — circular avatars are a messaging convention */
          className="relative cursor-pointer rounded-full transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          <Avatar
            src={currentUser.avatarDataUrl}
            pending={currentUser.avatarPending}
            placeholder={currentUser.avatarPlaceholder}
            className="size-14"
          />
          {/* Camera badge: full-round like the avatar it sits on, with the
              card surface as the ring so the two circles read as cut out. */}
          <span className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Camera aria-hidden="true" weight="fill" className="size-3.5" />
          </span>
        </button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
          void upload(file);
        }}
      />
      {error ? (
        <p role="alert" className="max-w-40 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
