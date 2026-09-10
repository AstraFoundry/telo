import { ArrowUp, X } from "@phosphor-icons/react";
import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect } from "react";

import { copy } from "shared/config/copy";
import { Button } from "shared/ui";

interface VoiceRecordingBarProps {
  readonly elapsedSeconds: number;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}

/**
 * The composer's live-recording row, swapped in for the text input while the
 * microphone is open — tdesktop's audio-recording strip: a pulsing record
 * dot, the elapsed clock, cancel, and send. Escape discards, matching
 * tdesktop's cancel shortcut.
 */
export function VoiceRecordingBar({
  elapsedSeconds,
  onSend,
  onCancel,
}: VoiceRecordingBarProps) {
  const reduce = useReducedMotionConfig();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="status"
      aria-label={copy.voiceRecordingInProgress}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-border/80 bg-background px-3 py-2"
    >
      {/* The pulse is the only "live" cue besides the clock; under reduced
          motion the dot stays solid instead of breathing. */}
      <motion.span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full bg-destructive"
        animate={reduce ? { opacity: 1 } : { opacity: [1, 0.35, 1] }}
        transition={
          reduce
            ? { duration: 0 }
            : {
                duration: 1.6,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }
        }
      />
      {/* tabular-nums keeps the clock from jiggling the row as digits change. */}
      <span className="text-sm tabular-nums text-muted-foreground">
        {Math.floor(elapsedSeconds / 60)}:
        {String(elapsedSeconds % 60).padStart(2, "0")}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={copy.cancelVoiceRecording}
          className="size-10 rounded-full"
          onClick={onCancel}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
        <Button
          size="icon"
          aria-label={copy.sendVoiceMessage}
          className="size-10 rounded-full"
          onClick={onSend}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}
