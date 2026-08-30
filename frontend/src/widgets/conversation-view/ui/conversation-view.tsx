import {
  ArrowBendUpLeft,
  ArrowClockwise,
  ArrowFatLineRight,
  ArrowSquareOut,
  CheckCircle,
  Checks,
  CircleNotch,
  Copy,
  DownloadSimple,
  MagicWand,
  MagnifyingGlass,
  PencilSimple,
  PushPin,
  Translate,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type {
  MessageAgentActionTone,
  MessageDto,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { chatsForFolder, useChatStore } from "entities/chat";
import { useMessageTextSize, useTimeFormat } from "entities/preferences";
import { InChatSearchBar } from "features/chat-search";
import { MessageComposer } from "features/send-message";
import { AgentToggle } from "features/toggle-agent";
import { ChatProfileToggle } from "features/toggle-chat-profile";
import { copy } from "shared/config/copy";
import { useEdgeSentinel } from "shared/lib/use-edge-sentinel";
import { useHotkeys } from "shared/lib/use-hotkeys";
import {
  Avatar,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MediaViewer,
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageMarker,
  MessageScroller,
  MessageTyping,
  MessageRichText,
  MessageMedia,
  LoadIndicator,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
  PressableBlock,
  Tooltip,
  EASE_OUT,
} from "shared/ui";
import type { MediaViewerItem, MediaViewerOrigin } from "shared/ui";

import { DeleteMessageDialog } from "./delete-message-dialog";
import { ForwardPickerDialog } from "./forward-picker-dialog";
import { ForwardSelectedDialog } from "./forward-selected-dialog";
import { PinnedMessageBar } from "./pinned-message-bar";
import {
  groupTranscript,
  isVisualMedia,
  mediaDownloadKey,
} from "./media-groups";

const MEDIA_LABELS = {
  download: copy.downloadMedia,
  cancel: copy.cancelDownload,
  retry: copy.retryDownload,
  reveal: copy.revealSpoiler,
  failed: copy.mediaDownloadFailed,
  expand: copy.viewMedia,
} as const;

const DRAFT_REPLY_TONES: ReadonlyArray<{
  tone: MessageAgentActionTone;
  label: string;
}> = [
  { tone: "neutral", label: copy.draftReplyToneNeutral },
  { tone: "friendly", label: copy.draftReplyToneFriendly },
  { tone: "formal", label: copy.draftReplyToneFormal },
];

// "system" defers to the locale's hour12 default, while 12h/24h pin it
// explicitly.
function time(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

// Groups the transcript into day buckets, Telegram-style: a marker renders
// once at the start of each calendar day instead of on every message.
function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const startOfDay = (input: Date) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(today) - startOfDay(date)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return copy.today;
  if (diffDays === 1) return copy.yesterday;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  }).format(date);
}

function dayKey(value: string): string {
  return new Date(value).toDateString();
}

// Desktop hover rail: the highest-frequency bubble actions as an absolute
// overlay, so it never shifts layout. It appears on hover (precise pointers
// only) and focus-within with at most a 100ms opacity fade — no springs. The
// right-click context menu stays the full action list.
function MessageHoverRail({
  message,
  agentActionsAvailable,
}: {
  message: MessageDto;
  agentActionsAvailable: boolean;
}) {
  const startReply = useChatStore((state) => state.startReply);
  const runMessageAction = useChatStore((state) => state.runMessageAction);
  const messageAction = useChatStore((state) => state.messageAction);
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div
      className={`pointer-events-none absolute -top-3 z-10 flex items-center gap-0.5 rounded-xl border border-border bg-popover p-0.5 opacity-0 shadow-md transition-opacity duration-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 pointer-fine:group-hover/message:pointer-events-auto pointer-fine:group-hover/message:opacity-100 motion-reduce:transition-none ${
        message.outgoing ? "right-0" : "left-0"
      }`}
    >
      {message.status !== "failed" ? (
        <Tooltip content={copy.reply}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.reply}
            className="size-10"
            onClick={() => startReply(message)}
          >
            <ArrowBendUpLeft aria-hidden="true" className="size-4" />
          </Button>
        </Tooltip>
      ) : null}
      {agentActionsAvailable ? (
        <MorphPopover open={aiOpen} onOpenChange={setAiOpen}>
          <MorphPopoverTrigger>
            <Button
              size="icon"
              variant="ghost"
              aria-label={copy.aiActions}
              className="size-10"
            >
              <MagicWand aria-hidden="true" className="size-4" />
            </Button>
          </MorphPopoverTrigger>
          <MorphPopoverContent
            side="top"
            align={message.outgoing ? "end" : "start"}
            className="w-44 p-1"
          >
            <div
              role="group"
              aria-label={copy.aiActions}
              className="flex flex-col"
            >
              <Button
                variant="ghost"
                disabled={messageAction !== null}
                className="h-10 w-full justify-start rounded-lg px-2.5 text-sm font-normal"
                onClick={() => {
                  setAiOpen(false);
                  void runMessageAction(message, "translate");
                }}
              >
                {copy.translateMessage}
              </Button>
              <Button
                variant="ghost"
                disabled={messageAction !== null}
                className="h-10 w-full justify-start rounded-lg px-2.5 text-sm font-normal"
                onClick={() => {
                  setAiOpen(false);
                  void runMessageAction(message, "rewrite");
                }}
              >
                {copy.rewriteMessage}
              </Button>
              <div className="px-2.5 pt-1.5 pb-0.5 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {copy.draftReply}
              </div>
              {DRAFT_REPLY_TONES.map(({ tone, label }) => (
                <Button
                  key={tone}
                  variant="ghost"
                  disabled={messageAction !== null}
                  className="h-10 w-full justify-start rounded-lg px-2.5 text-sm font-normal"
                  onClick={() => {
                    setAiOpen(false);
                    void runMessageAction(message, "draft-reply", tone);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </MorphPopoverContent>
        </MorphPopover>
      ) : null}
    </div>
  );
}

const DELIVERY_CROSSFADE = { duration: 0.14, ease: EASE_OUT } as const;

function ChatTypingIndicator({ className }: { className?: string }) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    return <span className={className}>{copy.typing}</span>;
  }
  return <MessageTyping label={copy.typing} className={className} />;
}

function deliveryLabel(status: MessageDto["status"]): string {
  if (status === "failed") return copy.messageSendFailed;
  if (status === "sending") return copy.messageSending;
  if (status === "read") return copy.messageRead;
  return copy.messageSent;
}

function DeliveryGlyph({ status }: { status: MessageDto["status"] }) {
  const reduce = useReducedMotion() ?? false;
  const glyph =
    status === "failed" ? (
      <WarningCircle weight="fill" className="size-3.5 text-destructive" />
    ) : status === "sending" ? (
      <CircleNotch
        className={`size-3.5 ${reduce ? "" : "motion-safe:animate-spin"}`}
      />
    ) : (
      <Checks
        className="size-3.5"
        weight={status === "read" ? "bold" : "regular"}
      />
    );

  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={status}
          role="img"
          aria-label={deliveryLabel(status)}
          className="absolute inset-0 grid place-items-center"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={reduce ? { duration: 0 } : DELIVERY_CROSSFADE}
        >
          {glyph}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ConversationMessage({
  message,
  timeFormat,
  onForward,
  onDelete,
  onJumpToMessage,
  onOpenViewer,
}: {
  message: MessageDto;
  timeFormat: TimeFormatPreference;
  onForward(message: MessageDto): void;
  onDelete(message: MessageDto): void;
  onJumpToMessage(messageId: string): void;
  onOpenViewer(mediaId: string, trigger: HTMLElement): void;
}) {
  const startReply = useChatStore((state) => state.startReply);
  const startEdit = useChatStore((state) => state.startEdit);
  const resendMessage = useChatStore((state) => state.resendMessage);
  const runMessageAction = useChatStore((state) => state.runMessageAction);
  const messageAction = useChatStore((state) => state.messageAction);
  const startSelection = useChatStore((state) => state.startSelection);
  const toggleSelection = useChatStore((state) => state.toggleSelection);
  const selecting = useChatStore(
    (state) => state.selectedMessageIds.length > 0,
  );
  const selected = useChatStore((state) =>
    state.selectedMessageIds.includes(message.id),
  );
  const highlighted = useChatStore(
    (state) => state.highlightedMessageId === message.id,
  );
  const animateIn = useChatStore((state) =>
    state.animateInMessageIds.includes(message.id),
  );
  const mediaKey = message.media ? mediaDownloadKey(message.media) : null;
  const fileMedia =
    message.media && message.media.kind !== "webpage" ? message.media : null;
  const mediaDownload = useChatStore((state) =>
    mediaKey ? (state.mediaDownloads[mediaKey] ?? null) : null,
  );
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const cancelMediaDownload = useChatStore(
    (state) => state.cancelMediaDownload,
  );
  // Byte progress is reserved for downloads the user explicitly started;
  // scroll-into-view preloads stay quiet placeholders.
  const [explicitDownload, setExplicitDownload] = useState(false);
  const [actionError, setActionError] = useState<{ detail: string } | null>(
    null,
  );
  // The selection is snapshotted when the menu opens, not at render time: the
  // portal keeps its items mounted while closed, so render-time reads go stale.
  const [selection, setSelection] = useState("");

  // AI actions transform a server-persisted message body: optimistic
  // (sending) and failed bubbles never reached Telegram, and media-only
  // messages have no text to transform, so the entries stay hidden there.
  const agentActionsAvailable =
    (message.status === "sent" || message.status === "read") &&
    Boolean(message.body?.trim());
  const runningAction =
    messageAction?.messageId === message.id ? messageAction : null;

  // Thumbnail preload: once the bubble scrolls into view, fetch its media
  // quietly. A failed or cancelled preload is left to an explicit retry.
  const preloadRef = useEdgeSentinel({
    enabled: mediaKey !== null && mediaDownload === null,
    onReach: () => {
      if (mediaKey) void downloadMedia(mediaKey);
    },
  });

  const runMediaAction = async (action: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await action();
    } catch (error) {
      setActionError({
        detail: error instanceof Error ? error.message : "",
      });
    }
  };

  // The selection toggle always sits on the row's leading edge; on outgoing
  // rows (flex-row-reverse) that means rendering it after the content.
  const selectionToggle = selecting ? (
    <Button
      size="icon"
      variant="ghost"
      aria-label={selected ? copy.deselectMessage : copy.selectMessage}
      aria-pressed={selected}
      className="size-10 shrink-0 self-center"
      onClick={() => toggleSelection(message.id)}
    >
      <CheckCircle
        aria-hidden="true"
        weight={selected ? "fill" : "regular"}
        className={selected ? "text-primary" : "text-muted-foreground"}
      />
    </Button>
  ) : null;

  return (
    <Message
      id={`conversation-message-${message.id}`}
      from={message.outgoing ? "user" : "assistant"}
      animateIn={animateIn}
      // Search/jump highlight: a static background tint, never motion.
      data-highlighted={highlighted ? "true" : undefined}
      data-animate-in={animateIn ? "true" : undefined}
      className={highlighted ? "rounded-xl bg-primary/10" : undefined}
    >
      {message.outgoing ? null : selectionToggle}
      <MessageContent className="relative">
        {!message.outgoing ? (
          <MessageHeader>{message.senderName}</MessageHeader>
        ) : null}
        <ContextMenu
          onOpenChange={(open) => {
            if (open) setSelection(window.getSelection()?.toString() ?? "");
          }}
        >
          <ContextMenuTrigger>
            <MessageBubble variant={message.outgoing ? "tint" : "soft"}>
              {/* Font size comes from the --message-font-size variable set on
                  the conversation column; 14px matches text-sm before the
                  preference resolves. */}
              <MessageBubbleContent className="text-[length:var(--message-font-size,14px)]">
                {message.forwardedFrom ? (
                  <div className="mb-1 text-xs text-muted-foreground">
                    {copy.forwardedFrom}{" "}
                    <span className="font-medium text-foreground/80">
                      {message.forwardedFrom}
                    </span>
                  </div>
                ) : null}
                {message.replyTo ? (
                  <PressableBlock
                    aria-label={copy.jumpToMessage}
                    onClick={(event) => {
                      event.stopPropagation();
                      onJumpToMessage(message.replyTo!.id);
                    }}
                    className="mb-1 rounded-none border-l-2 border-primary pl-2"
                  >
                    <div className="truncate font-medium text-primary">
                      {message.replyTo.senderName}
                    </div>
                    <MessageRichText
                      compact
                      className="text-foreground/70"
                      body={message.replyTo.body}
                      entities={message.replyTo.entities}
                      revealSpoilerLabel={copy.revealSpoiler}
                    />
                  </PressableBlock>
                ) : null}
                {message.media ? (
                  <div ref={mediaKey ? preloadRef : undefined}>
                    <MessageMedia
                      media={message.media}
                      download={mediaDownload}
                      labels={MEDIA_LABELS}
                      downloadIsExplicit={explicitDownload}
                      onDownload={() => {
                        setExplicitDownload(true);
                        if (mediaKey) void downloadMedia(mediaKey);
                      }}
                      onCancel={() => {
                        if (mediaKey) void cancelMediaDownload(mediaKey);
                      }}
                      onOpen={
                        fileMedia && isVisualMedia(fileMedia)
                          ? (trigger) => onOpenViewer(fileMedia.id, trigger)
                          : undefined
                      }
                    />
                  </div>
                ) : null}
                {message.body ? (
                  <MessageRichText
                    body={message.body}
                    entities={message.entities}
                    revealSpoilerLabel={copy.revealSpoiler}
                  />
                ) : null}
              </MessageBubbleContent>
            </MessageBubble>
          </ContextMenuTrigger>
          <ContextMenuContent ariaLabel={copy.messageActions}>
            {/* A failed send never reached Telegram, so Reply/Edit/Forward —
                which reference a server-side message — stay hidden; Resend and
                Delete are the meaningful actions. */}
            {message.status === "failed" ? (
              <ContextMenuItem onSelect={() => void resendMessage(message.id)}>
                <ArrowClockwise aria-hidden="true" className="size-4" />
                {copy.resendMessage}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onSelect={() => startReply(message)}>
                <ArrowBendUpLeft aria-hidden="true" className="size-4" />
                {copy.reply}
              </ContextMenuItem>
            )}
            {message.outgoing && message.status !== "failed" ? (
              <ContextMenuItem onSelect={() => startEdit(message)}>
                <PencilSimple aria-hidden="true" className="size-4" />
                {copy.editMessage}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              onSelect={() =>
                void navigator.clipboard?.writeText(selection || message.body)
              }
            >
              <Copy aria-hidden="true" className="size-4" />
              {selection ? copy.copySelectedText : copy.copyText}
            </ContextMenuItem>
            {message.status !== "failed" ? (
              <ContextMenuItem onSelect={() => onForward(message)}>
                <ArrowFatLineRight aria-hidden="true" className="size-4" />
                {copy.forward}
              </ContextMenuItem>
            ) : null}
            {message.status !== "failed" ? (
              <ContextMenuItem onSelect={() => startSelection(message.id)}>
                <CheckCircle aria-hidden="true" className="size-4" />
                {copy.selectMessage}
              </ContextMenuItem>
            ) : null}
            {fileMedia ? (
              <>
                <ContextMenuItem
                  onSelect={() =>
                    void runMediaAction(() =>
                      window.telo.workspace.openMedia(fileMedia.id),
                    )
                  }
                >
                  <ArrowSquareOut aria-hidden="true" className="size-4" />
                  {copy.openMedia}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    void runMediaAction(() =>
                      window.telo.workspace.saveMediaAs(
                        fileMedia.id,
                        fileMedia.fileName,
                      ),
                    )
                  }
                >
                  <DownloadSimple aria-hidden="true" className="size-4" />
                  {copy.saveMediaAs}
                </ContextMenuItem>
              </>
            ) : null}
            {agentActionsAvailable ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={messageAction !== null}
                  onSelect={() => void runMessageAction(message, "translate")}
                >
                  {runningAction?.kind === "translate" ? (
                    <CircleNotch
                      aria-hidden="true"
                      className="size-4 motion-safe:animate-spin"
                    />
                  ) : (
                    <Translate aria-hidden="true" className="size-4" />
                  )}
                  {copy.translateMessage}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={messageAction !== null}
                  onSelect={() => void runMessageAction(message, "rewrite")}
                >
                  {runningAction?.kind === "rewrite" ? (
                    <CircleNotch
                      aria-hidden="true"
                      className="size-4 motion-safe:animate-spin"
                    />
                  ) : (
                    <MagicWand aria-hidden="true" className="size-4" />
                  )}
                  {copy.rewriteMessage}
                </ContextMenuItem>
                <ContextMenuLabel inset>{copy.draftReply}</ContextMenuLabel>
                {DRAFT_REPLY_TONES.map(({ tone, label }) => (
                  <ContextMenuItem
                    key={tone}
                    inset
                    disabled={messageAction !== null}
                    onSelect={() =>
                      void runMessageAction(message, "draft-reply", tone)
                    }
                  >
                    {runningAction?.kind === "draft-reply" &&
                    runningAction.tone === tone ? (
                      <CircleNotch
                        aria-hidden="true"
                        className="size-4 motion-safe:animate-spin"
                      />
                    ) : null}
                    {label}
                  </ContextMenuItem>
                ))}
              </>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem
              tone="destructive"
              onSelect={() => onDelete(message)}
            >
              <Trash aria-hidden="true" className="size-4" />
              {copy.deleteMessage}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {/* Selection mode swaps the hover rail for per-row checkboxes. */}
        {selecting ? null : (
          <MessageHoverRail
            message={message}
            agentActionsAvailable={agentActionsAvailable}
          />
        )}
        {actionError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {copy.mediaActionFailed}
            {actionError.detail ? `: ${actionError.detail}` : ""}
          </p>
        ) : null}
        <MessageFooter className="text-foreground/70 tabular-nums">
          {message.editedAt ? <span>{copy.edited}</span> : null}
          <time>{time(message.sentAt, timeFormat)}</time>
          {message.outgoing ? <DeliveryGlyph status={message.status} /> : null}
        </MessageFooter>
      </MessageContent>
      {message.outgoing ? selectionToggle : null}
    </Message>
  );
}

function AlbumMessage({
  messages,
  timeFormat,
  onOpenViewer,
}: {
  messages: ReadonlyArray<MessageDto>;
  timeFormat: TimeFormatPreference;
  onOpenViewer(mediaId: string, trigger: HTMLElement): void;
}) {
  const first = messages[0];
  const mediaDownloads = useChatStore((state) => state.mediaDownloads);
  const highlighted = useChatStore((state) =>
    messages.some((message) => message.id === state.highlightedMessageId),
  );
  const animateIn = useChatStore((state) =>
    messages.some((message) => state.animateInMessageIds.includes(message.id)),
  );
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const cancelMediaDownload = useChatStore(
    (state) => state.cancelMediaDownload,
  );
  const tiles = messages.flatMap((message) =>
    isVisualMedia(message.media) ? [{ message, media: message.media }] : [],
  );
  const pendingPreload = tiles.some(
    ({ media }) => mediaDownloads[media.id] === undefined,
  );
  // Album thumbnails preload together once the grid scrolls into view.
  const preloadRef = useEdgeSentinel({
    enabled: pendingPreload,
    onReach: () => {
      const downloads = useChatStore.getState().mediaDownloads;
      for (const { media } of tiles) {
        if (downloads[media.id] === undefined) void downloadMedia(media.id);
      }
    },
  });

  return (
    <Message
      id={`conversation-message-${first.id}`}
      from={first.outgoing ? "user" : "assistant"}
      animateIn={animateIn}
      data-highlighted={highlighted ? "true" : undefined}
      data-animate-in={animateIn ? "true" : undefined}
      className={highlighted ? "rounded-xl bg-primary/10" : undefined}
    >
      <MessageContent>
        {!first.outgoing ? (
          <MessageHeader>{first.senderName}</MessageHeader>
        ) : null}
        <MessageBubble variant={first.outgoing ? "tint" : "soft"}>
          <MessageBubbleContent className="text-[length:var(--message-font-size,14px)]">
            {first.forwardedFrom ? (
              <div className="mb-1 text-xs text-muted-foreground">
                {copy.forwardedFrom}{" "}
                <span className="font-medium text-foreground/80">
                  {first.forwardedFrom}
                </span>
              </div>
            ) : null}
            <div
              ref={preloadRef}
              className="grid max-w-md grid-cols-2 gap-0.5 overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            >
              {tiles.map(({ message, media }) => (
                <MessageMedia
                  key={message.id}
                  tile
                  media={media}
                  download={mediaDownloads[media.id] ?? null}
                  labels={MEDIA_LABELS}
                  onDownload={() => void downloadMedia(media.id)}
                  onCancel={() => void cancelMediaDownload(media.id)}
                  onOpen={(trigger) => onOpenViewer(media.id, trigger)}
                />
              ))}
            </div>
            {/* The album caption rides on the first tile's message. */}
            {first.body ? (
              <MessageRichText
                className="mt-2"
                body={first.body}
                entities={first.entities}
                revealSpoilerLabel={copy.revealSpoiler}
              />
            ) : null}
          </MessageBubbleContent>
        </MessageBubble>
        <MessageFooter className="text-foreground/70 tabular-nums">
          {first.editedAt ? <span>{copy.edited}</span> : null}
          <time>{time(first.sentAt, timeFormat)}</time>
          {first.outgoing ? <DeliveryGlyph status={first.status} /> : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

interface ViewerState {
  readonly mediaId: string;
  readonly origin: MediaViewerOrigin | null;
}

function ConversationMediaViewer({
  viewer,
  onClose,
  onNavigate,
}: {
  viewer: ViewerState | null;
  onClose(): void;
  onNavigate(mediaId: string): void;
}) {
  const messages = useChatStore((state) => state.messages);
  const mediaDownloads = useChatStore((state) => state.mediaDownloads);
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const [actionError, setActionError] = useState<{ detail: string } | null>(
    null,
  );

  const items = useMemo(
    () =>
      messages.flatMap((message) =>
        isVisualMedia(message.media)
          ? [
              {
                id: message.media.id,
                kind: message.media.kind,
                fileName: message.media.fileName,
                caption: message.body || null,
              },
            ]
          : [],
      ),
    [messages],
  );
  const index = viewer
    ? items.findIndex((item) => item.id === viewer.mediaId)
    : -1;
  const current = index >= 0 ? items[index] : null;
  const currentDownload = current ? (mediaDownloads[current.id] ?? null) : null;
  const currentUrl =
    currentDownload?.state === "ready" ? currentDownload.url : null;

  // Navigating to media that is not cached yet fetches it in place.
  const currentId = current?.id ?? null;
  const needsDownload = currentId !== null && currentDownload === null;
  useEffect(() => {
    if (needsDownload && currentId) void downloadMedia(currentId);
  }, [needsDownload, currentId, downloadMedia]);

  const item: MediaViewerItem | null = current
    ? { ...current, url: currentUrl }
    : null;

  const runAction = async (action: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await action();
    } catch (error) {
      setActionError({
        detail: error instanceof Error ? error.message : "",
      });
    }
  };

  return (
    <MediaViewer
      item={item}
      index={index}
      count={items.length}
      origin={viewer?.origin ?? null}
      labels={{
        viewer: copy.mediaViewer,
        close: copy.closeViewer,
        previous: copy.previousMedia,
        next: copy.nextMedia,
        saveAs: copy.saveMediaAs,
        open: copy.openMedia,
        loading: copy.loading,
      }}
      error={
        actionError
          ? `${copy.mediaActionFailed}${actionError.detail ? `: ${actionError.detail}` : ""}`
          : null
      }
      onClose={onClose}
      onNavigate={(next) => {
        const target = items[next];
        if (target) onNavigate(target.id);
      }}
      onSaveAs={(target) =>
        void runAction(() =>
          window.telo.workspace.saveMediaAs(target.id, target.fileName),
        )
      }
      onOpen={(target) =>
        void runAction(() => window.telo.workspace.openMedia(target.id))
      }
    />
  );
}

// Menus, dialogs, and overlays own their keyboard semantics while open (the
// context menu's arrows, a dialog's Escape); workspace shortcuts stay out of
// the way until they close. BEUI keeps closed overlays mounted behind an
// aria-hidden ancestor, which is how "open" is detected here.
function overlayOpen(): boolean {
  for (const overlay of document.querySelectorAll(
    '[role="menu"], [role="dialog"], [role="listbox"]',
  )) {
    if (!overlay.closest('[aria-hidden="true"]')) return true;
  }
  return false;
}

function focusInChatSearchField(): void {
  document
    .querySelector<HTMLInputElement>(
      `input[aria-label="${copy.searchMessages}"]`,
    )
    ?.focus();
}

// Arrow keys walk the chat list of the active folder; because selecting a
// chat opens it here, navigation and opening are the same step. The walk
// clamps at both ends, Telegram-Desktop style, and pauses while the sidebar
// search has a query (its result list owns the list context then).
function navigateChatList(direction: 1 | -1, event: KeyboardEvent): void {
  const state = useChatStore.getState();
  if (overlayOpen() || state.searchQuery.trim()) return;
  const visible = chatsForFolder(state.chats, state.activeFolderId);
  const index = visible.findIndex((chat) => chat.id === state.activeChatId);
  const next = visible[index + direction];
  if (!next) return;
  event.preventDefault();
  void state.select(next.id);
  requestAnimationFrame(() => {
    document
      .querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  });
}

export function ConversationView() {
  const chats = useChatStore((state) => state.chats);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const messages = useChatStore((state) => state.messages);
  const loading = useChatStore((state) => state.loading);
  const syncError = useChatStore((state) => state.syncError);
  const messageCursor = useChatStore((state) => state.messageCursor);
  const loadingOlderMessages = useChatStore(
    (state) => state.loadingOlderMessages,
  );
  const loadOlderMessages = useChatStore((state) => state.loadOlderMessages);
  const send = useChatStore((state) => state.send);
  const setScrollPosition = useChatStore((state) => state.setScrollPosition);
  const togglePin = useChatStore((state) => state.togglePin);
  const chatSearchOpen = useChatStore((state) => state.chatSearch.open);
  const openChatSearch = useChatStore((state) => state.openChatSearch);
  const closeChatSearch = useChatStore((state) => state.closeChatSearch);
  const exitSelection = useChatStore((state) => state.exitSelection);
  const messageActionError = useChatStore((state) => state.messageActionError);
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const { value: timeFormat } = useTimeFormat();
  const { value: textSize } = useMessageTextSize();
  const [forwardSource, setForwardSource] = useState<MessageDto | null>(null);
  const [deleteSource, setDeleteSource] = useState<MessageDto | null>(null);
  const [selectionDeleteOpen, setSelectionDeleteOpen] = useState(false);
  const [selectionForwardOpen, setSelectionForwardOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const selectedMessageIds = useChatStore((state) => state.selectedMessageIds);
  const selecting = selectedMessageIds.length > 0;
  // The delete dialog needs the outgoing flags of the whole selection, not
  // just the ids, to decide whether "for everyone" is on the table.
  const selectedMessages = useMemo(
    () =>
      selecting
        ? messages.filter((message) => selectedMessageIds.includes(message.id))
        : [],
    [messages, selectedMessageIds, selecting],
  );
  const composerRegionRef = useRef<HTMLDivElement | null>(null);
  const openViewer = useCallback((mediaId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    setViewer({
      mediaId,
      origin: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
  }, []);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const prependAnchorRef = useRef<{
    firstMessageId: string | undefined;
    height: number;
    top: number;
  } | null>(null);
  const restoredChatIdRef = useRef<string | null>(null);
  const restoreFrameRef = useRef<{ outer: number; inner: number } | null>(null);

  const focusComposer = useCallback(() => {
    composerRegionRef.current?.querySelector("textarea")?.focus();
  }, []);

  // Workspace keyboard shortcuts. Handlers read the store imperatively so
  // the binding list stays referentially stable across renders. Reply is
  // bound to the multi-select model: R replies only when exactly one message
  // is selected, which is the unambiguous case.
  useHotkeys([
    {
      key: "f",
      metaOrCtrl: true,
      allowInInputs: true,
      handler: (event) => {
        const state = useChatStore.getState();
        if (!state.activeChatId) return;
        event.preventDefault();
        if (state.chatSearch.open) focusInChatSearchField();
        else state.openChatSearch();
      },
    },
    {
      key: "Escape",
      allowInInputs: true,
      handler: () => {
        if (overlayOpen()) return;
        const state = useChatStore.getState();
        if (state.selectedMessageIds.length > 0) state.exitSelection();
        else if (state.composerTarget) state.cancelComposerTarget();
        else if (state.chatSearch.open) state.closeChatSearch();
      },
    },
    {
      key: "r",
      handler: (event) => {
        if (overlayOpen()) return;
        const state = useChatStore.getState();
        if (state.selectedMessageIds.length !== 1) return;
        const target = state.messages.find(
          (message) => message.id === state.selectedMessageIds[0],
        );
        if (!target || target.status === "failed") return;
        event.preventDefault();
        state.startReply(target);
        state.exitSelection();
        focusComposer();
      },
    },
    {
      key: "Delete",
      handler: (event) => {
        if (overlayOpen()) return;
        if (useChatStore.getState().selectedMessageIds.length === 0) return;
        event.preventDefault();
        setSelectionDeleteOpen(true);
      },
    },
    {
      key: "Backspace",
      handler: (event) => {
        if (overlayOpen()) return;
        if (useChatStore.getState().selectedMessageIds.length === 0) return;
        event.preventDefault();
        setSelectionDeleteOpen(true);
      },
    },
    {
      key: "ArrowUp",
      handler: (event) => navigateChatList(-1, event),
    },
    {
      key: "ArrowDown",
      handler: (event) => navigateChatList(1, event),
    },
    {
      // Arrow keys already open the chat they land on; Enter completes the
      // jump by moving focus into the conversation's composer — unless the
      // focus sits on a control that owns Enter itself.
      key: "Enter",
      handler: () => {
        if (overlayOpen()) return;
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          focused.closest(
            'button, a, input, textarea, select, [role="tab"], [contenteditable="true"]',
          )
        ) {
          return;
        }
        focusComposer();
      },
    },
  ]);

  // Telegram Desktop convention: ArrowUp in an empty composer edits the last
  // outgoing message. Runs in the capture phase so the textarea's own caret
  // handling never sees the key.
  const startEditLastOutgoing = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp") return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.value !== "") {
      return;
    }
    const state = useChatStore.getState();
    if (state.composerTarget) return;
    const last = [...state.messages]
      .reverse()
      .find(
        (message) =>
          message.outgoing &&
          (message.status === "sent" || message.status === "read") &&
          Boolean(message.body?.trim()),
      );
    if (!last) return;
    event.preventDefault();
    state.startEdit(last);
  };

  const requestOlderMessages = useCallback(() => {
    const viewport = transcriptRef.current;
    if (!viewport || loadingOlderMessages || !messageCursor) return;
    // Snapshot before the fetch; the compensation below runs after React
    // commits the prepended page, so the read position never visibly jumps.
    prependAnchorRef.current = {
      firstMessageId: messages[0]?.id,
      height: viewport.scrollHeight,
      top: viewport.scrollTop,
    };
    void loadOlderMessages();
  }, [loadingOlderMessages, messageCursor, messages, loadOlderMessages]);

  // The unread divider sits before the first message past the read boundary
  // (`lastReadMessageId`). While the boundary message is above the loaded
  // page the divider stays hidden and the effect below keeps paging; with
  // history exhausted, every loaded message is unread, so it sits on top.
  const lastReadMessageId = activeChat?.lastReadMessageId ?? null;
  const hasUnread = (activeChat?.unreadCount ?? 0) > 0;
  const unreadBoundaryIndex = useMemo(() => {
    if (!hasUnread) return null;
    const boundary = lastReadMessageId
      ? messages.findIndex((message) => message.id === lastReadMessageId)
      : -1;
    if (boundary !== -1) return boundary + 1;
    if (messageCursor) return null;
    return messages.length > 0 ? 0 : null;
  }, [hasUnread, lastReadMessageId, messages, messageCursor]);

  // Page older history until the read boundary is loaded, so the divider can
  // be placed — the same auto-paging pattern as the reply jump loader, with
  // the top sentinel's scroll compensation.
  useEffect(() => {
    if (!hasUnread || !lastReadMessageId || !messageCursor) return;
    if (loadingOlderMessages) return;
    if (messages.some((message) => message.id === lastReadMessageId)) return;
    requestOlderMessages();
  }, [
    hasUnread,
    lastReadMessageId,
    messageCursor,
    loadingOlderMessages,
    messages,
    requestOlderMessages,
  ]);

  const firstMessageId = messages[0]?.id;
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    prependAnchorRef.current = null;
    const viewport = transcriptRef.current;
    if (!anchor || !viewport || firstMessageId === anchor.firstMessageId)
      return;
    const delta = viewport.scrollHeight - anchor.height;
    if (delta > 0) viewport.scrollTop = anchor.top + delta;
  }, [messages, firstMessageId]);

  // Reselecting a chat with a saved read position restores it once the page
  // has painted; MessageScroller's own "follow the live edge" auto-scroll
  // (which runs on its own rAF) always wins otherwise, so this restore runs a
  // frame later to have the final word. A brand-new chat (no saved offset)
  // is left alone and simply lands at the live edge, as before.
  useLayoutEffect(() => {
    if (!activeChatId || messages.length === 0) return;
    if (restoredChatIdRef.current === activeChatId) return;
    restoredChatIdRef.current = activeChatId;
    const saved = useChatStore.getState().scrollPositions[activeChatId];
    if (saved === undefined) return;
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        const viewport = transcriptRef.current;
        if (viewport) viewport.scrollTop = saved;
      });
      restoreFrameRef.current = { outer, inner };
    });
    restoreFrameRef.current = { outer, inner: 0 };
    return () => {
      cancelAnimationFrame(outer);
      if (restoreFrameRef.current) {
        cancelAnimationFrame(restoreFrameRef.current.inner);
      }
    };
  }, [activeChatId, messages]);

  // Pages older history until the target message is loaded, then centers it.
  // Store reads go through getState so the callback stays referentially
  // stable for the jump-target effect below.
  const jumpToMessage = useCallback(async (messageId: string) => {
    const scrollIntoView = (element: HTMLElement) => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const existing = document.getElementById(
      `conversation-message-${messageId}`,
    );
    if (existing) {
      scrollIntoView(existing);
      return;
    }
    // The reply target may live further back than the loaded page: keep
    // paging older messages until it appears or history runs out.
    const maxAttempts = 25;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!useChatStore.getState().messageCursor) break;
      await useChatStore.getState().loadOlderMessages();
      const found = document.getElementById(
        `conversation-message-${messageId}`,
      );
      if (found) {
        scrollIntoView(found);
        return;
      }
    }
  }, []);

  // Global search results and in-chat search navigation ask the store for a
  // jump; this effect performs it (paging until the message is loaded),
  // highlights the match, and clears the request.
  const jumpTarget = useChatStore((state) => state.jumpTarget);
  useEffect(() => {
    if (!jumpTarget || jumpTarget.chatId !== activeChatId || loading) return;
    let cancelled = false;
    void (async () => {
      await jumpToMessage(jumpTarget.messageId);
      if (cancelled) return;
      const state = useChatStore.getState();
      if (state.jumpTarget?.requestId === jumpTarget.requestId) {
        state.setHighlightedMessage(jumpTarget.messageId);
        state.clearJumpTarget();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jumpTarget, activeChatId, loading, jumpToMessage]);

  // History paging is sentinel-driven (Telegram-style), not a button: when
  // the top marker scrolls into view, the next older page loads.
  const topSentinelRef = useEdgeSentinel({
    enabled: Boolean(messageCursor) && !loadingOlderMessages,
    onReach: requestOlderMessages,
  });

  // Consecutive messages sharing a groupedId collapse into one album unit;
  // day markers and the unread divider anchor on the unit's first message.
  const transcriptUnits = useMemo(() => groupTranscript(messages), [messages]);

  return (
    <main
      className="flex min-w-0 flex-col"
      style={{ "--message-font-size": `${textSize}px` } as CSSProperties}
    >
      <header className="flex h-14 items-center gap-2 px-4 [app-region:drag]">
        {activeChat ? (
          <Avatar
            initials={activeChat.initials}
            src={activeChat.avatarDataUrl}
            className="size-8"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          {/* deslop-ignore-next-line 12 */}
          <h1 className="truncate text-base font-semibold">
            {activeChat?.title ?? ""}
          </h1>
          {activeChat?.typing ? (
            <span className="block text-xs text-muted-foreground">
              <ChatTypingIndicator />
            </span>
          ) : activeChat?.presence === "online" ? (
            <span className="block text-xs text-primary">{copy.online}</span>
          ) : null}
        </div>
        <div className="flex gap-1 [app-region:no-drag]">
          <Tooltip content={copy.searchInChatShortcut}>
            <Button
              size="icon"
              variant={chatSearchOpen ? "secondary" : "ghost"}
              aria-label={copy.searchInChat}
              aria-pressed={chatSearchOpen}
              className="size-10"
              disabled={!activeChatId}
              onClick={() =>
                chatSearchOpen ? closeChatSearch() : openChatSearch()
              }
            >
              <MagnifyingGlass weight={chatSearchOpen ? "fill" : "regular"} />
            </Button>
          </Tooltip>
          {activeChat ? (
            <Tooltip
              content={activeChat.pinned ? copy.unpinChat : copy.pinChat}
            >
              <Button
                size="icon"
                variant="ghost"
                aria-label={activeChat.pinned ? copy.unpinChat : copy.pinChat}
                aria-pressed={activeChat.pinned}
                className="size-10"
                onClick={() => void togglePin(activeChat.id)}
              >
                <PushPin weight={activeChat.pinned ? "fill" : "regular"} />
              </Button>
            </Tooltip>
          ) : null}
          <ChatProfileToggle />
          <AgentToggle />
        </div>
      </header>
      <InChatSearchBar />
      {activeChatId ? <PinnedMessageBar chatId={activeChatId} /> : null}
      {syncError ? (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <WarningCircle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="min-w-0">
            <span className="font-medium">{copy.syncError}</span>
            {syncError !== copy.syncError ? (
              <span className="ml-1 text-destructive/80">{syncError}</span>
            ) : null}
          </span>
        </div>
      ) : null}
      <MessageScroller
        label={copy.conversation}
        className="min-h-0 flex-1"
        contentClassName="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-5"
        viewportRef={transcriptRef}
        viewportProps={{
          onScroll: () => {
            if (activeChatId && transcriptRef.current) {
              setScrollPosition(activeChatId, transcriptRef.current.scrollTop);
            }
          },
        }}
      >
        {messageCursor ? (
          <div ref={topSentinelRef} className="flex justify-center">
            {/* popLayout: the exiting spinner leaves layout immediately, so the
                prepend compensation never measures it. */}
            <AnimatePresence initial={false} mode="popLayout">
              {loadingOlderMessages ? (
                <LoadIndicator bubble label={copy.loadingEarlierMessages} />
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
        {transcriptUnits.map((unit) => {
          const first = unit.messages[0];
          const showDayMarker =
            unit.startIndex === 0 ||
            dayKey(first.sentAt) !==
              dayKey(messages[unit.startIndex - 1].sentAt);
          const showUnreadBoundary =
            unreadBoundaryIndex !== null &&
            unreadBoundaryIndex >= unit.startIndex &&
            unreadBoundaryIndex < unit.startIndex + unit.messages.length;
          return (
            <Fragment key={unit.key}>
              {showDayMarker ? (
                <MessageMarker>{dayLabel(first.sentAt)}</MessageMarker>
              ) : null}
              {showUnreadBoundary ? (
                <MessageMarker className="bg-primary/10 font-medium text-primary">
                  {copy.unreadMessages}
                </MessageMarker>
              ) : null}
              {unit.messages.length === 1 ? (
                <ConversationMessage
                  message={first}
                  timeFormat={timeFormat}
                  onForward={setForwardSource}
                  onDelete={setDeleteSource}
                  onJumpToMessage={(messageId) => void jumpToMessage(messageId)}
                  onOpenViewer={openViewer}
                />
              ) : (
                <AlbumMessage
                  messages={unit.messages}
                  timeFormat={timeFormat}
                  onOpenViewer={openViewer}
                />
              )}
            </Fragment>
          );
        })}
      </MessageScroller>
      <div className="px-5 py-3">
        <div
          ref={composerRegionRef}
          className="mx-auto w-full max-w-3xl"
          onKeyDownCapture={startEditLastOutgoing}
        >
          {messageActionError ? (
            <p
              role="alert"
              className="mb-2 text-xs text-pretty text-destructive"
            >
              <span className="font-medium">{copy.messageActionFailed}</span>{" "}
              {messageActionError}
            </p>
          ) : null}
          {selecting ? (
            // Selection mode swaps the composer for the batch action bar. It
            // is static: entering and leaving selection is instant.
            <div
              role="region"
              aria-label={copy.selectionActions}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 text-sm font-medium tabular-nums">
                {selectedMessageIds.length} {copy.messagesSelected}
              </span>
              <Button
                variant="ghost"
                className="h-10 gap-1.5 px-3"
                onClick={() => setSelectionForwardOpen(true)}
              >
                <ArrowFatLineRight aria-hidden="true" className="size-4" />
                {copy.forward}
              </Button>
              <Button
                variant="ghost"
                className="h-10 gap-1.5 px-3 text-destructive hover:text-destructive"
                onClick={() => setSelectionDeleteOpen(true)}
              >
                <Trash aria-hidden="true" className="size-4" />
                {copy.deleteMessage}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={copy.exitSelection}
                className="size-10"
                onClick={exitSelection}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ) : (
            <MessageComposer disabled={!activeChatId} onSend={send} />
          )}
        </div>
      </div>
      <ForwardPickerDialog
        message={forwardSource}
        onClose={() => setForwardSource(null)}
      />
      <ForwardSelectedDialog
        open={selectionForwardOpen && selecting}
        onClose={() => setSelectionForwardOpen(false)}
      />
      <DeleteMessageDialog
        messages={deleteSource ? [deleteSource] : null}
        onClose={() => setDeleteSource(null)}
      />
      <DeleteMessageDialog
        messages={
          selectionDeleteOpen && selectedMessages.length > 0
            ? selectedMessages
            : null
        }
        onClose={() => setSelectionDeleteOpen(false)}
      />
      <ConversationMediaViewer
        viewer={viewer}
        onClose={() => setViewer(null)}
        onNavigate={(mediaId) => setViewer({ mediaId, origin: null })}
      />
    </main>
  );
}
