import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useEffect } from "react";
import type { PointerEvent } from "react";

import { cn } from "shared/lib/cn";

import { clampColumnWidth } from "../model/layout";

const KEYBOARD_STEP_PX = 16;

interface ColumnResizeHandleProps {
  readonly label: string;
  /** Current column width in CSS pixels, mirrored to aria-valuenow. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /**
   * Which column edge the handle sits on: a "leading" column (chat list)
   * grows toward the trailing edge; a "trailing" column (agent panel) grows
   * toward the leading edge, so its drag and arrow-key deltas invert.
   */
  readonly edge: "leading" | "trailing";
  readonly style?: CSSProperties;
  /** Direct-manipulation preview: fires per frame while dragging. */
  readonly onPreview: (width: number) => void;
  /** Fires once when a drag or keyboard nudge settles on a width. */
  readonly onCommit: (width: number) => void;
  /** Double-click restores the default width. */
  readonly onReset: () => void;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  width: number;
}

/**
 * The vertical grab zone between two workspace columns. The visible line is a
 * hairline, but the invisible hit zone spans 16px and the full column height.
 * Dragging is 1:1 with the pointer: the width previews through onPreview
 * (rAF-throttled, no React state per pointermove) and only the settled width
 * commits on release.
 */
export function ColumnResizeHandle({
  label,
  value,
  min,
  max,
  edge,
  style,
  onPreview,
  onCommit,
  onReset,
}: ColumnResizeHandleProps) {
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef(0);

  function previewWidth(width: number): void {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => onPreview(width));
  }

  function endDrag(cancelled: boolean): void {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    document.documentElement.style.cursor = "";
    if (!cancelled && drag.width !== drag.startWidth) onCommit(drag.width);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: valueRef.current,
      width: valueRef.current,
    };
    // Pointer capture keeps the events coming but the cursor still follows
    // the element under the pointer, so pin it for the drag's duration.
    document.documentElement.style.cursor = "col-resize";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientX - drag.startX;
    const width = clampColumnWidth(
      drag.startWidth + (edge === "leading" ? delta : -delta),
      min,
      max,
    );
    drag.width = width;
    previewWidth(width);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const delta =
      event.key === "ArrowLeft"
        ? -KEYBOARD_STEP_PX
        : event.key === "ArrowRight"
          ? KEYBOARD_STEP_PX
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    onCommit(
      clampColumnWidth(
        valueRef.current + (edge === "leading" ? delta : -delta),
        min,
        max,
      ),
    );
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      style={style}
      className={cn(
        "group absolute inset-y-0 z-20 w-4 cursor-col-resize touch-none select-none",
        edge === "leading" ? "-translate-x-1/2" : "translate-x-1/2",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => endDrag(false)}
      onPointerCancel={() => endDrag(true)}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-border group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}
