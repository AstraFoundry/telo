import { BellSlash, Paperclip, X } from "@phosphor-icons/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import {
  useChatStore,
  type ComposerTarget,
  type SendOptions,
} from "entities/chat";
import { useRecentEmojis, useSendWithEnter } from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  Button,
  ContextMenuItem,
  MessageAttachmentTray,
  PromptInput,
} from "shared/ui";

import { RECENT_EMOJIS_MAX } from "../model/emoji-data";
import { namePastedFile } from "../model/pasted-file-name";
import { EmojiPicker } from "./emoji-picker";

interface SelectedFile {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string | null;
}

interface MessageComposerProps {
  disabled?: boolean;
  onSend(body: string, options?: SendOptions): Promise<void>;
}

export function MessageComposer({ disabled, onSend }: MessageComposerProps) {
  const [value, setValue] = useState("");
  // Fully-formed failure copy: the title names what failed (send, upload, or
  // selection), the detail carries the underlying error message.
  const [failure, setFailure] = useState<{
    title: string;
    detail: string | null;
  } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<
    ReadonlyArray<SelectedFile>
  >([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const { value: sendWithEnter } = useSendWithEnter();
  const { value: recentEmojis, select: selectRecentEmojis } = useRecentEmojis();
  const activeChatId = useChatStore((state) => state.activeChatId);
  const setDraft = useChatStore((state) => state.setDraft);
  const composerTarget = useChatStore((state) => state.composerTarget);
  const cancelComposerTarget = useChatStore(
    (state) => state.cancelComposerTarget,
  );
  const sendMedia = useChatStore((state) => state.sendMedia);
  const cancelMediaUpload = useChatStore((state) => state.cancelMediaUpload);
  const upload = useChatStore((state) =>
    uploadId ? (state.mediaUploads[uploadId] ?? null) : null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedFilesRef = useRef(selectedFiles);
  const cancelledUploads = useRef(new Set<string>());
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
  // Nested dragenter/dragleave pairs (tray, textarea, buttons) must not
  // flicker the drop highlight, so depth is counted rather than toggled.
  const dragDepth = useRef(0);

  // Attachments mirror the attach button's disabled state: the picker, drag
  // and drop, and paste all share one gate.
  const attachmentsBlocked =
    disabled || uploadId !== null || composerTarget?.mode === "edit";

  // Edit mode prefills the input with the original body; leaving edit mode
  // (cancel or send) clears it again. Switching chats swaps the text for that
  // chat's own draft (typed locally or synced from another Telegram client)
  // instead of leaking the previous chat's unsent text. Reply mode never
  // touches typed text. Both transitions are resolved together, during
  // render, so a chat switch and an edit start landing in the same commit
  // don't race to overwrite each other's textarea value.
  const [previousTarget, setPreviousTarget] = useState<ComposerTarget | null>(
    null,
  );
  const [previousChatId, setPreviousChatId] = useState(activeChatId);
  const targetChanged = composerTarget !== previousTarget;
  const chatChanged = activeChatId !== previousChatId;
  if (targetChanged || chatChanged) {
    if (targetChanged) setPreviousTarget(composerTarget);
    if (chatChanged) setPreviousChatId(activeChatId);
    if (composerTarget?.mode === "edit") {
      setValue(composerTarget.preview);
    } else if (
      targetChanged &&
      !composerTarget &&
      previousTarget?.mode === "edit"
    ) {
      setValue("");
    } else if (chatChanged) {
      setValue(
        activeChatId
          ? (useChatStore.getState().drafts[activeChatId] ?? "")
          : "",
      );
    }
  }

  // Message AI actions stream into the draft through the store; the
  // draftStream signal mirrors each write into the textarea. Keystrokes and
  // sends already flow through onValueChange/onSubmit, and edit mode owns the
  // text, so none of them pass through here. Like the target/chat sync above,
  // the mirror runs during render so the textarea never paints a stale value.
  const draftStream = useChatStore((state) => state.draftStream);
  const [previousStream, setPreviousStream] = useState(draftStream);
  if (draftStream !== previousStream) {
    setPreviousStream(draftStream);
    if (
      draftStream &&
      draftStream.chatId === activeChatId &&
      composerTarget?.mode !== "edit"
    ) {
      setValue(draftStream.text);
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

  // Mirror the selection into a ref (post-render only) so the unmount cleanup
  // can revoke every outstanding object URL without re-subscribing per file.
  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  });

  useEffect(
    () => () => {
      for (const selected of selectedFilesRef.current) {
        if (selected.previewUrl) URL.revokeObjectURL(selected.previewUrl);
      }
    },
    [],
  );

  const clearSelectedFiles = () => {
    for (const selected of selectedFiles) {
      if (selected.previewUrl) URL.revokeObjectURL(selected.previewUrl);
    }
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Single intake for attachments: the file picker, drag and drop, and paste
  // all land here so the 10-file cap and image previews behave identically
  // regardless of how the file arrived.
  const addFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    if (selectedFiles.length + files.length > 10) {
      setFailure({ title: copy.tooManyAttachments, detail: null });
      return;
    }
    setSelectedFiles((current) => [
      ...current,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      })),
    ]);
    setFailure(null);
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    addFiles(files);
    // Reset so picking the same file again re-fires the change event.
    event.currentTarget.value = "";
  };

  const isFileDrag = (dataTransfer: DataTransfer) =>
    [...dataTransfer.types].includes("Files");

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (!attachmentsBlocked) setDropActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;
    // Always claim file drags, even when attachments are blocked: an
    // unhandled drop would navigate the Electron window to the file.
    event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    if (attachmentsBlocked) return;
    addFiles([...event.dataTransfer.files]);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0 || attachmentsBlocked) return;
    event.preventDefault();
    addFiles(files.map((file) => namePastedFile(file)));
  };

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
    const next = `${textarea.value.slice(0, textarea.selectionStart)}\n${textarea.value.slice(textarea.selectionEnd)}`;
    setValue(next);
    if (activeChatId) setDraft(activeChatId, next);
  };

  const submit = async (body: string, options?: SendOptions) => {
    const currentUploadId =
      selectedFiles.length > 0 ? crypto.randomUUID() : null;
    try {
      if (currentUploadId) {
        setUploadId(currentUploadId);
        await sendMedia(
          selectedFiles.map((selected) => selected.file),
          body,
          currentUploadId,
        );
        // A cancel whose promise still resolves is done: drop the marker.
        cancelledUploads.current.delete(currentUploadId);
        clearSelectedFiles();
      } else {
        // Callers that don't model send options still see a single argument.
        await (options ? onSend(body, options) : onSend(body));
      }
      setValue("");
      setFailure(null);
    } catch (reason) {
      // A cancelled upload is the user's own action, not a failure. Any
      // other rejection keeps the files and caption in place so the send
      // button becomes a one-click retry of the same attachments.
      if (
        !currentUploadId ||
        !cancelledUploads.current.delete(currentUploadId)
      ) {
        setFailure({
          title: currentUploadId
            ? copy.mediaUploadFailed
            : copy.messageSendFailed,
          detail: reason instanceof Error ? reason.message : String(reason),
        });
      }
    } finally {
      setUploadId(null);
    }
  };

  // The silent flag rides SendMessageInput only; the context-menu item is
  // disabled while attachments are staged, so this always sends plain text.
  const sendSilently = () => {
    const body = value.trim();
    if (!body) return;
    void submit(body, { silent: true });
  };

  const insertEmoji = (glyph: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${glyph}${value.slice(end)}`;
    setValue(next);
    if (activeChatId && composerTarget?.mode !== "edit") {
      setDraft(activeChatId, next);
    }
    if (textarea) {
      pendingCaret.current = { textarea, caret: start + glyph.length };
      textarea.focus({ preventScroll: true });
    }
    selectRecentEmojis(
      [glyph, ...recentEmojis.filter((recent) => recent !== glyph)].slice(
        0,
        RECENT_EMOJIS_MAX,
      ),
    );
  };

  const targetTitle =
    composerTarget?.mode === "edit"
      ? copy.editingMessage
      : replySenderName
        ? `${copy.replyingTo} ${replySenderName}`
        : copy.replyingTo;

  return (
    <div
      className="flex flex-col gap-2"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
        loading={uploadId !== null}
        allowEmptySubmit={selectedFiles.length > 0}
        inputRef={textareaRef}
        onPaste={handlePaste}
        sendMenuLabel={copy.sendOptions}
        sendMenuContent={
          <ContextMenuItem
            disabled={
              selectedFiles.length > 0 || composerTarget?.mode === "edit"
            }
            onSelect={sendSilently}
          >
            <BellSlash aria-hidden="true" className="size-4" />
            {copy.sendWithoutSound}
          </ContextMenuItem>
        }
        onStop={() => {
          if (!uploadId) return;
          cancelledUploads.current.add(uploadId);
          void cancelMediaUpload(uploadId);
        }}
        attachmentPreview={
          selectedFiles.length > 0 ? (
            <MessageAttachmentTray
              items={selectedFiles.map((selected) => ({
                id: selected.id,
                name: selected.file.name,
                size: selected.file.size,
                previewUrl: selected.previewUrl,
              }))}
              progress={upload?.state === "uploading" ? upload.progress : null}
              removeLabel={(name) => `${copy.removeAttachment}: ${name}`}
              onRemove={(id) => {
                const selected = selectedFiles.find((item) => item.id === id);
                if (selected?.previewUrl)
                  URL.revokeObjectURL(selected.previewUrl);
                setSelectedFiles((current) =>
                  current.filter((item) => item.id !== id),
                );
              }}
            />
          ) : undefined
        }
        leadingAction={
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
              onChange={selectFiles}
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-10 rounded-full"
              aria-label={copy.attachFiles}
              disabled={attachmentsBlocked}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" className="size-4" />
            </Button>
            <EmojiPicker
              disabled={disabled || uploadId !== null}
              recentEmojis={recentEmojis}
              onPick={insertEmoji}
            />
          </>
        }
        onValueChange={(next) => {
          setValue(next);
          if (failure) setFailure(null);
          if (activeChatId && composerTarget?.mode !== "edit") {
            setDraft(activeChatId, next);
          }
        }}
        onKeyDown={handleKeyDown}
        onSubmit={(body) => submit(body)}
        /* deslop-ignore-next-line 21 — rounded composer on a flat surface, no nesting parent */
        className={
          dropActive
            ? "rounded-xl border-primary/60 bg-primary/5"
            : "rounded-xl"
        }
      />
      {failure ? (
        <p role="alert" className="px-2 text-xs text-destructive text-pretty">
          <span className="font-medium">{failure.title}</span>
          {failure.detail ? <span> {failure.detail}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
