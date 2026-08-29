import { X } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { useChatStore, type ComposerTarget } from "entities/chat";
import { useSendWithEnter } from "entities/preferences";
import { copy } from "shared/config/copy";
import { Button, PromptInput } from "shared/ui";

interface MessageComposerProps {
  disabled?: boolean;
  onSend(body: string): Promise<void>;
}

export function MessageComposer({ disabled, onSend }: MessageComposerProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { value: sendWithEnter } = useSendWithEnter();
  const composerTarget = useChatStore((state) => state.composerTarget);
  const cancelComposerTarget = useChatStore(
    (state) => state.cancelComposerTarget,
  );
  const replySenderName = useChatStore((state) =>
    state.composerTarget?.mode === "reply"
      ? state.messages.find(
          (message) => message.id === state.composerTarget?.messageId,
        )?.senderName
      : undefined,
  );
  const pendingCaret = useRef<{
    textarea: HTMLTextAreaElement;
    caret: number;
  } | null>(null);

  // Edit mode prefills the input with the original body; leaving edit mode
  // (cancel or send) clears it again. Reply mode never touches typed text.
  // State adjusts during render so the textarea updates in the same pass as
  // the preview bar.
  const [previousTarget, setPreviousTarget] = useState<ComposerTarget | null>(
    null,
  );
  if (composerTarget !== previousTarget) {
    setPreviousTarget(composerTarget);
    if (composerTarget?.mode === "edit") {
      setValue(composerTarget.preview);
    } else if (!composerTarget && previousTarget?.mode === "edit") {
      setValue("");
    }
  }

  // Restores the caret after a manually inserted newline re-renders the
  // controlled textarea, which would otherwise move it to the end.
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    pending.textarea.setSelectionRange(pending.caret, pending.caret);
  });

  // With sendWithEnter off, beui would still submit on a bare Enter (it only
  // exempts Shift+Enter), so the keydown is intercepted first. preventDefault
  // also suppresses the textarea's native newline, so it is inserted manually.
  // Cmd/Ctrl+Enter keeps submitting through beui untouched, as does IME
  // composition.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendWithEnter) return;
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    pendingCaret.current = {
      textarea,
      caret: textarea.selectionStart + 1,
    };
    setValue(
      `${textarea.value.slice(0, textarea.selectionStart)}\n${textarea.value.slice(textarea.selectionEnd)}`,
    );
  };

  const targetTitle =
    composerTarget?.mode === "edit"
      ? copy.editingMessage
      : replySenderName
        ? `${copy.replyingTo} ${replySenderName}`
        : copy.replyingTo;

  return (
    <div className="flex flex-col gap-2">
      {composerTarget ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span
            aria-hidden="true"
            className="h-8 w-0.5 shrink-0 rounded-full bg-primary"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-medium text-primary">
              {targetTitle}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {composerTarget.preview}
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.cancel}
            className="-mr-2 size-10 shrink-0"
            onClick={cancelComposerTarget}
          >
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      ) : null}
      <PromptInput
        minRows={1}
        maxRows={5}
        disabled={disabled}
        placeholder={copy.messagePlaceholder}
        aria-label={copy.messagePlaceholder}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        onSubmit={async (body) => {
          try {
            await onSend(body);
            setValue("");
            setError(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
        /* deslop-ignore-next-line 21 — rounded composer on a flat surface, no nesting parent */
        className="rounded-xl"
      />
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive text-pretty">
          <span className="font-medium">{copy.messageSendFailed}</span>{" "}
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
