"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  DownloadSimple,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { LoadIndicator } from "./load-indicator";

/** One visual-media entry the viewer can show; `url` is null until cached. */
export interface MediaViewerItem {
  readonly id: string;
  readonly kind: "photo" | "video" | "animation" | "video-note";
  readonly url: string | null;
  readonly fileName: string | null;
  readonly caption: string | null;
}

/** Viewport-relative rect of the thumbnail the viewer was opened from. */
export interface MediaViewerOrigin {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MediaViewerLabels {
  readonly viewer: string;
  readonly close: string;
  readonly previous: string;
  readonly next: string;
  readonly saveAs: string;
  readonly open: string;
  readonly loading: string;
}

export interface MediaViewerProps {
  /** The item to show; null closes the viewer (with an exit transition). */
  readonly item: MediaViewerItem | null;
  readonly index: number;
  readonly count: number;
  readonly origin?: MediaViewerOrigin | null;
  readonly labels: MediaViewerLabels;
  /** Transient action failure (save-as/open), rendered as an alert. */
  readonly error?: string | null;
  onNavigate(index: number): void;
  onClose(): void;
  onSaveAs(item: MediaViewerItem): void;
  onOpen(item: MediaViewerItem): void;
}

const VIEWER_TRANSITION = { duration: 0.2, ease: "easeOut" } as const;
const VIEWER_EXIT_TRANSITION = { duration: 0.16, ease: "easeOut" } as const;

/**
 * Telegram-style lightbox: an occasional overlay, so it gets motion — the
 * surface scales out of the thumbnail it was opened from (and back into it),
 * while reduced motion swaps the transform for a plain fade. Escape and
 * click-away close; arrow keys move between the chat's media.
 */
export function MediaViewer({
  item,
  index,
  count,
  origin,
  labels,
  error,
  onNavigate,
  onClose,
  onSaveAs,
  onOpen,
}: MediaViewerProps) {
  const reduce = useReducedMotion() ?? false;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // The exit transition still needs the closing item after `item` turns null;
  // remember the last open item by adjusting state during render (the React-
  // sanctioned previous-prop pattern).
  const [lastItem, setLastItem] = useState<MediaViewerItem | null>(item);
  if (item && item !== lastItem) {
    setLastItem(item);
  }
  const renderedItem = item ?? lastItem;

  useEffect(() => {
    if (!item) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowLeft" && index > 0) {
        onNavigate(index - 1);
      } else if (event.key === "ArrowRight" && index < count - 1) {
        onNavigate(index + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, index, count, onClose, onNavigate]);

  const open = item !== null;
  const video =
    renderedItem?.kind === "video" || renderedItem?.kind === "video-note";

  return (
    <AnimatePresence>
      {open && renderedItem ? (
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={labels.viewer}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-black/85 outline-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: VIEWER_EXIT_TRANSITION }}
          transition={VIEWER_TRANSITION}
          onClick={onClose}
        >
          <div
            className="flex items-center justify-end gap-1 p-3"
            onClick={(event) => event.stopPropagation()}
          >
            {error ? (
              <p
                role="alert"
                className="mr-auto max-w-md truncate rounded-lg bg-destructive/15 px-3 py-1.5 text-xs text-destructive-foreground"
              >
                {error}
              </p>
            ) : null}
            <ViewerAction
              label={labels.open}
              onClick={() => onOpen(renderedItem)}
            >
              <ArrowSquareOut aria-hidden="true" className="size-5" />
            </ViewerAction>
            <ViewerAction
              label={labels.saveAs}
              onClick={() => onSaveAs(renderedItem)}
            >
              <DownloadSimple aria-hidden="true" className="size-5" />
            </ViewerAction>
            <ViewerAction label={labels.close} onClick={onClose}>
              <X aria-hidden="true" className="size-5" />
            </ViewerAction>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-4">
            {count > 1 ? (
              <div
                className="absolute inset-y-0 left-3 flex items-center"
                onClick={(event) => event.stopPropagation()}
              >
                <ViewerAction
                  label={labels.previous}
                  disabled={index <= 0}
                  onClick={() => onNavigate(index - 1)}
                >
                  <ArrowLeft aria-hidden="true" className="size-5" />
                </ViewerAction>
              </div>
            ) : null}
            <motion.div
              className="flex max-h-full max-w-full items-center justify-center"
              initial={reduce ? { opacity: 0 } : closedTransform(origin)}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={
                reduce
                  ? { opacity: 0, transition: VIEWER_EXIT_TRANSITION }
                  : {
                      ...closedTransform(origin),
                      transition: VIEWER_EXIT_TRANSITION,
                    }
              }
              transition={VIEWER_TRANSITION}
              onClick={(event) => event.stopPropagation()}
            >
              {renderedItem.url ? (
                video ? (
                  <video
                    key={renderedItem.id}
                    src={renderedItem.url}
                    controls
                    autoPlay
                    aria-label={renderedItem.fileName ?? undefined}
                    className="max-h-[80vh] max-w-full rounded-lg shadow-2xl"
                  />
                ) : (
                  <img
                    key={renderedItem.id}
                    src={renderedItem.url}
                    alt={renderedItem.fileName ?? ""}
                    className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
                  />
                )
              ) : (
                <LoadIndicator label={labels.loading} />
              )}
            </motion.div>
            {count > 1 ? (
              <div
                className="absolute inset-y-0 right-3 flex items-center"
                onClick={(event) => event.stopPropagation()}
              >
                <ViewerAction
                  label={labels.next}
                  disabled={index >= count - 1}
                  onClick={() => onNavigate(index + 1)}
                >
                  <ArrowRight aria-hidden="true" className="size-5" />
                </ViewerAction>
              </div>
            ) : null}
          </div>
          {renderedItem.caption ? (
            <div
              className="flex justify-center px-6 pb-5"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="max-w-2xl text-center text-sm text-pretty text-white/90">
                {renderedItem.caption}
              </p>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ViewerAction({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  // A raw button on purpose: shared/ui primitives are leaf components and
  // cannot reach back into the vendored registry (import boundary). The 40px
  // hit area and press feedback match the barrel's icon buttons.
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full text-white/85 transition-[color,background-color,scale] duration-150 hover:bg-white/10 hover:text-white active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// The figure's closed state mirrors the thumbnail's viewport rect: same
// center, scaled down to the thumbnail's relative size. Without an origin
// (keyboard navigation, tests) it settles for a gentle 0.95 scale-in.
function closedTransform(origin: MediaViewerOrigin | null | undefined): {
  opacity: number;
  x: number;
  y: number;
  scale: number;
} {
  if (
    !origin ||
    origin.width <= 0 ||
    origin.height <= 0 ||
    typeof window === "undefined"
  ) {
    return { opacity: 0, x: 0, y: 0, scale: 0.95 };
  }
  const scale = Math.max(0.05, Math.min(1, origin.width / window.innerWidth));
  return {
    opacity: 0,
    x: origin.x + origin.width / 2 - window.innerWidth / 2,
    y: origin.y + origin.height / 2 - window.innerHeight / 2,
    scale,
  };
}
