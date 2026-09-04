import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";

const HOLD_DELAY_MS = 400;
const HOLD_TOLERANCE_PX = 10;
const STICKER_ID_ATTRIBUTE = "data-sticker-id";

export interface StickerPreviewGestureProps {
  readonly stickers: ReadonlyArray<StickerItemDto>;
  readonly children: ReactNode;
  onPreview(sticker: StickerItemDto | null): void;
}

/**
 * Telegram's sticker-grid gesture: hold one cell to preview it, slide over
 * neighboring cells to scrub the preview, then release without sending.
 */
export function StickerPreviewGesture({
  stickers,
  children,
  onPreview,
}: StickerPreviewGestureProps) {
  const timer = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const active = useRef(false);
  const pressedSticker = useRef<StickerItemDto | null>(null);
  const gestureSurface = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const stickersById = useMemo(
    () => new Map(stickers.map((sticker) => [sticker.id, sticker])),
    [stickers],
  );

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const releaseSelection = useCallback(() => {
    gestureSurface.current?.style.removeProperty("user-select");
    gestureSurface.current?.style.removeProperty("-webkit-user-select");
  }, []);

  const finish = useCallback(
    (cancelClick: boolean) => {
      clearTimer();
      if (active.current) {
        active.current = false;
        suppressClick.current = cancelClick;
        onPreview(null);
      }
      pointerId.current = null;
      pressedSticker.current = null;
      releaseSelection();
    },
    [clearTimer, onPreview, releaseSelection],
  );

  useEffect(() => () => finish(false), [finish]);

  useEffect(() => {
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId.current) finish(true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId.current) finish(false);
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [finish]);

  const stickerAt = (x: number, y: number): StickerItemDto | null => {
    const elements = document.elementsFromPoint?.(x, y) ?? [];
    for (const element of elements) {
      const cell = element.closest<HTMLElement>(`[${STICKER_ID_ATTRIBUTE}]`);
      const id = cell?.dataset.stickerId;
      if (id) return stickersById.get(id) ?? null;
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    const cell = (event.target as Element).closest<HTMLElement>(
      `[${STICKER_ID_ATTRIBUTE}]`,
    );
    const sticker = cell?.dataset.stickerId
      ? (stickersById.get(cell.dataset.stickerId) ?? null)
      : null;
    if (!sticker) return;

    finish(false);
    pointerId.current = event.pointerId;
    origin.current = { x: event.clientX, y: event.clientY };
    pressedSticker.current = sticker;
    gestureSurface.current = event.currentTarget;
    event.currentTarget.style.setProperty("user-select", "none");
    event.currentTarget.style.setProperty("-webkit-user-select", "none");
    timer.current = window.setTimeout(() => {
      active.current = true;
      timer.current = null;
      onPreview(pressedSticker.current);
    }, HOLD_DELAY_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerId.current) return;
    if (!active.current) {
      if (
        Math.hypot(
          event.clientX - origin.current.x,
          event.clientY - origin.current.y,
        ) > HOLD_TOLERANCE_PX
      ) {
        finish(false);
      }
      return;
    }
    event.preventDefault();
    const sticker = stickerAt(event.clientX, event.clientY);
    if (sticker && sticker.id !== pressedSticker.current?.id) {
      pressedSticker.current = sticker;
      onPreview(sticker);
    }
  };

  return (
    <div
      className="contents"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (event.pointerId === pointerId.current) finish(true);
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === pointerId.current) finish(false);
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
