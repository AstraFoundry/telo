import { ArrowLeft, CaretRight, X } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  ChatDto,
  MessageDto,
  MessageFileMediaDto,
  TimeFormatPreference,
} from "../../../../../contracts/src/ipc";
import { useChatProfileStore, useChatStore } from "entities/chat";
import { useTimeFormat } from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  AnimatedSidebar,
  AnimatedSidebarProvider,
  Avatar,
  Button,
  LoadIndicator,
  MediaViewer,
  MessageMedia,
  Tooltip,
} from "shared/ui";
import type { MediaViewerOrigin } from "shared/ui";

const MEDIA_LABELS = {
  download: copy.downloadMedia,
  cancel: copy.cancelDownload,
  retry: copy.retryDownload,
  reveal: copy.revealSpoiler,
  failed: copy.mediaDownloadFailed,
  expand: copy.viewMedia,
} as const;

// The profile grid shows a page of shared media; deeper history pages in
// through the transcript cursor when the backend grows paging UI.
const SHARED_MEDIA_LIMIT = 30;
const SHARED_MEDIA_PREVIEW = 6;
const PINNED_PREVIEW = 3;

// The panel reuses the right-column width the workspace layout publishes for
// the agent panel, capped to the viewport for the narrow single-column shell.
const PROFILE_PANEL_WIDTH =
  "min(100%, var(--workspace-agent-panel-width, 380px))";

type ProfileView = "main" | "shared-media" | "pinned";

interface StackEntry {
  readonly view: ProfileView;
  /** Scroll offset the view had when it was left; Back restores it. */
  readonly scrollTop: number;
}

const MAIN_ENTRY: StackEntry = { view: "main", scrollTop: 0 };
const MAIN_STACK: ReadonlyArray<StackEntry> = [MAIN_ENTRY];

function isVisualMedia(
  media: MessageDto["media"],
): media is MessageFileMediaDto {
  return (
    media !== null &&
    media.kind !== "webpage" &&
    (media.kind === "photo" || media.kind === "video")
  );
}

function isFileMedia(media: MessageDto["media"]): media is MessageFileMediaDto {
  return media !== null && media.kind !== "webpage" && media.kind === "file";
}

// The header's subtitle line reports only what ChatDto knows: presence for
// direct chats, otherwise the conversation kind.
function subtitle(chat: ChatDto): string | null {
  if (chat.presence === "online") return copy.online;
  if (chat.kind === "group") return copy.chatKindGroup;
  if (chat.kind === "channel") return copy.chatKindChannel;
  return null;
}

// "system" defers to the locale's hour12 default, while 12h/24h pin it
// explicitly — the same formatter the transcript timestamps use.
function time(value: string, format: TimeFormatPreference): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12h" }),
  }).format(new Date(value));
}

interface MediaTile {
  readonly message: MessageDto;
  readonly media: MessageFileMediaDto;
}

function SectionHeader({
  label,
  count,
  onOpen,
}: {
  readonly label: string;
  readonly count: number;
  readonly onOpen: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onOpen}
      className="h-10 w-full justify-start gap-1.5 rounded-lg px-2 text-sm font-semibold"
    >
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="text-xs font-normal text-muted-foreground tabular-nums">
        {count}
      </span>
      <CaretRight aria-hidden="true" className="size-4 text-muted-foreground" />
    </Button>
  );
}

function PinnedRow({
  message,
  timeFormat,
  onJump,
}: {
  readonly message: MessageDto;
  readonly timeFormat: TimeFormatPreference;
  readonly onJump: (message: MessageDto) => void;
}) {
  const preview =
    message.body ||
    (message.media && message.media.kind !== "webpage"
      ? message.media.fileName
      : null) ||
    "";
  return (
    <Button
      variant="ghost"
      onClick={() => onJump(message)}
      /* deslop-ignore-next-line 21 — compact chat-row radius is a messaging convention */
      className="h-auto w-full justify-start rounded-xl px-2 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {message.senderName}
          </span>
          <time className="text-[11px] font-normal text-muted-foreground tabular-nums">
            {time(message.sentAt, timeFormat)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
          {preview}
        </span>
      </span>
    </Button>
  );
}

export function ChatProfilePanel() {
  const open = useChatProfileStore((state) => state.open);
  const openPanel = useChatProfileStore((state) => state.openPanel);
  const closePanel = useChatProfileStore((state) => state.closePanel);
  const chats = useChatStore((state) => state.chats);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const mediaDownloads = useChatStore((state) => state.mediaDownloads);
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const cancelMediaDownload = useChatStore(
    (state) => state.cancelMediaDownload,
  );
  const requestJumpToMessage = useChatStore(
    (state) => state.requestJumpToMessage,
  );
  const { value: timeFormat } = useTimeFormat();
  const chat = chats.find((entry) => entry.id === activeChatId) ?? null;

  // In-widget back stack: main → section views, each entry remembering the
  // scroll offset it was left at. The stack resets when the panel closes or
  // the conversation changes — the profile belongs to one chat.
  const [navigation, setNavigation] = useState<{
    key: string;
    stack: ReadonlyArray<StackEntry>;
  }>({ key: "", stack: MAIN_STACK });
  const navKey = `${open}:${activeChatId ?? ""}`;
  if (navigation.key !== navKey) {
    setNavigation({ key: navKey, stack: MAIN_STACK });
  }
  const stack = navigation.stack;
  const current = stack[stack.length - 1] ?? MAIN_ENTRY;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navigate = (view: ProfileView) => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    setNavigation((state) => ({
      key: state.key,
      stack: [
        ...state.stack.slice(0, -1),
        { ...(state.stack[state.stack.length - 1] ?? MAIN_ENTRY), scrollTop },
        { view, scrollTop: 0 },
      ],
    }));
  };
  const goBack = () => {
    setNavigation((state) =>
      state.stack.length > 1
        ? { key: state.key, stack: state.stack.slice(0, -1) }
        : state,
    );
  };

  // Back restores the popped view's scroll offset. The marker pins the
  // restore to navigation changes so live scrolling and late-arriving data
  // never fight the user.
  const restoredRef = useRef("");
  useLayoutEffect(() => {
    const marker = `${navKey}:${stack.length}:${current.view}`;
    if (restoredRef.current === marker) return;
    restoredRef.current = marker;
    if (scrollRef.current) scrollRef.current.scrollTop = current.scrollTop;
  });

  const [loaded, setLoaded] = useState<{
    key: string;
    sharedMedia: ReadonlyArray<MessageDto> | null;
    pinned: ReadonlyArray<MessageDto> | null;
    loadError: string | null;
  }>({ key: "", sharedMedia: null, pinned: null, loadError: null });
  // A panel reopen or chat switch invalidates the previous chat's data.
  if (loaded.key !== navKey) {
    setLoaded({
      key: navKey,
      sharedMedia: null,
      pinned: null,
      loadError: null,
    });
  }
  const { sharedMedia, pinned, loadError } = loaded;
  useEffect(() => {
    if (!open || !activeChatId) return;
    let cancelled = false;
    void Promise.all([
      window.telo.workspace.listSharedMedia(activeChatId, {
        limit: SHARED_MEDIA_LIMIT,
      }),
      window.telo.workspace.listPinnedMessages(activeChatId),
    ])
      .then(([mediaPage, pinnedMessages]) => {
        if (cancelled) return;
        setLoaded({
          key: navKey,
          sharedMedia: mediaPage.items,
          pinned: pinnedMessages,
          loadError: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded((state) => ({
          ...state,
          loadError: error instanceof Error ? error.message : String(error),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeChatId, navKey]);

  // The grid reads newest first; the page arrives in transcript order.
  const visualMedia = useMemo<ReadonlyArray<MediaTile>>(
    () =>
      (sharedMedia ?? []).flatMap((message) =>
        isVisualMedia(message.media) ? [{ message, media: message.media }] : [],
      ),
    [sharedMedia],
  );
  const visualNewestFirst = useMemo(
    () => [...visualMedia].reverse(),
    [visualMedia],
  );
  const fileMedia = useMemo<ReadonlyArray<MediaTile>>(
    () =>
      (sharedMedia ?? []).flatMap((message) =>
        isFileMedia(message.media) ? [{ message, media: message.media }] : [],
      ),
    [sharedMedia],
  );

  // The panel is an explicit surface, so its thumbnails fetch eagerly instead
  // of waiting for a scroll sentinel.
  useEffect(() => {
    if (!open) return;
    for (const { media } of visualMedia) {
      if (mediaDownloads[media.id] === undefined) void downloadMedia(media.id);
    }
  }, [open, visualMedia, mediaDownloads, downloadMedia]);

  const [viewer, setViewer] = useState<{
    mediaId: string;
    origin: MediaViewerOrigin | null;
  } | null>(null);
  const viewerItems = useMemo(
    () =>
      visualNewestFirst.map(({ message, media }) => ({
        id: media.id,
        kind: media.kind as "photo" | "video",
        fileName: media.fileName,
        caption: message.body || null,
      })),
    [visualNewestFirst],
  );
  const viewerIndex = viewer
    ? viewerItems.findIndex((item) => item.id === viewer.mediaId)
    : -1;
  const viewerCurrent = viewerIndex >= 0 ? viewerItems[viewerIndex] : null;
  const viewerDownload = viewerCurrent
    ? (mediaDownloads[viewerCurrent.id] ?? null)
    : null;
  const viewerId = viewerCurrent?.id ?? null;
  useEffect(() => {
    if (viewerId && viewerDownload === null) void downloadMedia(viewerId);
  }, [viewerId, viewerDownload, downloadMedia]);
  const [viewerError, setViewerError] = useState<{ detail: string } | null>(
    null,
  );
  const runViewerAction = async (action: () => Promise<unknown>) => {
    try {
      setViewerError(null);
      await action();
    } catch (error) {
      setViewerError({ detail: error instanceof Error ? error.message : "" });
    }
  };

  const openViewer = (mediaId: string, trigger: HTMLElement) => {
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
  };

  const renderGrid = (tiles: ReadonlyArray<MediaTile>) => (
    <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
      {tiles.map(({ message, media }) => (
        <MessageMedia
          key={message.id}
          tile
          media={media}
          download={mediaDownloads[media.id] ?? null}
          labels={MEDIA_LABELS}
          onDownload={() => void downloadMedia(media.id)}
          onCancel={() => void cancelMediaDownload(media.id)}
          onOpen={(trigger) => openViewer(media.id, trigger)}
        />
      ))}
    </div>
  );

  const renderFiles = (tiles: ReadonlyArray<MediaTile>) =>
    tiles.length ? (
      <section aria-label={copy.mediaFiles} className="flex flex-col gap-1">
        <div className="px-2 text-xs font-medium text-muted-foreground">
          {copy.mediaFiles}
        </div>
        {tiles.map(({ message, media }) => (
          <MessageMedia
            key={message.id}
            media={media}
            download={mediaDownloads[media.id] ?? null}
            labels={MEDIA_LABELS}
            onDownload={() => void downloadMedia(media.id)}
            onCancel={() => void cancelMediaDownload(media.id)}
          />
        ))}
      </section>
    ) : null;

  const renderPinnedRows = (messages: ReadonlyArray<MessageDto>) =>
    messages.map((message) => (
      <PinnedRow
        key={message.id}
        message={message}
        timeFormat={timeFormat}
        onJump={(target) => void requestJumpToMessage(target.chatId, target.id)}
      />
    ));

  const title =
    current.view === "shared-media"
      ? copy.sharedMedia
      : current.view === "pinned"
        ? copy.pinnedMessages
        : copy.chatProfile;

  return (
    <AnimatedSidebarProvider
      open={open}
      openMobile={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen === open) return;
        if (nextOpen) openPanel();
        else closePanel();
      }}
      onOpenMobileChange={(nextOpen) => {
        if (nextOpen === open) return;
        if (nextOpen) openPanel();
        else closePanel();
      }}
      style={{ "--sidebar-width": PROFILE_PANEL_WIDTH }}
    >
      <AnimatedSidebar
        side="right"
        collapsible="offcanvas"
        ariaLabel={copy.chatProfile}
        aria-hidden={!open}
        inert={!open}
        className="overflow-hidden"
        // Same shell as the agent panel: the central card's shadow carries
        // the separation, so the vendored border is overridden here.
        panelClassName="border-l-0 bg-transparent"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
          {stack.length > 1 ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={copy.back}
              className="size-10"
              onClick={goBack}
            >
              <ArrowLeft />
            </Button>
          ) : null}
          {/* deslop-ignore-next-line 12 */}
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {title}
          </h2>
          <Tooltip content={copy.closeChatProfile}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={copy.closeChatProfile}
              className="size-10"
              onClick={closePanel}
            >
              <X />
            </Button>
          </Tooltip>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {loadError ? (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              {copy.failed}: {loadError}
            </p>
          ) : null}
          {!chat ? null : sharedMedia === null || pinned === null ? (
            loadError ? null : (
              <div className="grid place-items-center py-10">
                <LoadIndicator label={copy.loading} />
              </div>
            )
          ) : current.view === "shared-media" ? (
            <div className="flex flex-col gap-4 px-4 py-4">
              {renderGrid(visualNewestFirst)}
              {renderFiles(fileMedia)}
            </div>
          ) : current.view === "pinned" ? (
            <div className="flex flex-col px-2 py-2">
              {renderPinnedRows(pinned)}
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-2 py-4">
              <div className="flex flex-col items-center gap-2 px-2 pb-3 text-center">
                <Avatar
                  initials={chat.initials}
                  src={chat.avatarDataUrl}
                  className="size-20 text-2xl font-semibold"
                />
                {/* deslop-ignore-next-line 12 */}
                <div className="text-base font-semibold text-balance">
                  {chat.title}
                </div>
                {subtitle(chat) ? (
                  <div className="text-sm text-muted-foreground">
                    {subtitle(chat)}
                  </div>
                ) : null}
              </div>
              {visualNewestFirst.length || fileMedia.length ? (
                <section aria-label={copy.sharedMedia}>
                  <SectionHeader
                    label={copy.sharedMedia}
                    count={visualNewestFirst.length + fileMedia.length}
                    onOpen={() => navigate("shared-media")}
                  />
                  <div className="px-2">
                    {renderGrid(
                      visualNewestFirst.slice(0, SHARED_MEDIA_PREVIEW),
                    )}
                  </div>
                </section>
              ) : null}
              {pinned.length ? (
                <section aria-label={copy.pinnedMessages}>
                  <SectionHeader
                    label={copy.pinnedMessages}
                    count={pinned.length}
                    onOpen={() => navigate("pinned")}
                  />
                  {renderPinnedRows(pinned.slice(0, PINNED_PREVIEW))}
                </section>
              ) : null}
            </div>
          )}
        </div>
        <MediaViewer
          item={
            viewerCurrent
              ? {
                  ...viewerCurrent,
                  url:
                    viewerDownload?.state === "ready"
                      ? viewerDownload.url
                      : null,
                }
              : null
          }
          index={viewerIndex}
          count={viewerItems.length}
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
            viewerError
              ? `${copy.mediaActionFailed}${viewerError.detail ? `: ${viewerError.detail}` : ""}`
              : null
          }
          onClose={() => setViewer(null)}
          onNavigate={(next) => {
            const target = viewerItems[next];
            if (target) setViewer({ mediaId: target.id, origin: null });
          }}
          onSaveAs={(target) =>
            void runViewerAction(() =>
              window.telo.workspace.saveMediaAs(target.id, target.fileName),
            )
          }
          onOpen={(target) =>
            void runViewerAction(() =>
              window.telo.workspace.openMedia(target.id),
            )
          }
        />
      </AnimatedSidebar>
    </AnimatedSidebarProvider>
  );
}
