import { useEffect, useRef } from "react";

export interface HotkeyBinding {
  /** `KeyboardEvent.key`, compared case-insensitively for single letters. */
  key: string;
  /** Requires Cmd (macOS) or Ctrl (elsewhere) — matches both, like Cmd/Ctrl+F. */
  metaOrCtrl?: boolean;
  /**
   * Fires while the focus is inside a text field. Most bindings must not;
   * native-feeling keys (Escape, Cmd+K) pass `true` here.
   */
  allowInInputs?: boolean;
  handler(event: KeyboardEvent): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

/**
 * Registers window-level keyboard shortcuts for the component's lifetime.
 * Bindings are matched in order against each keydown; a binding whose
 * handler calls `event.preventDefault()` stops later bindings and the
 * browser default. Bindings never fire while the user is typing in a field
 * unless `allowInInputs` is set, and never re-fire after another handler
 * already claimed the event.
 */
export function useHotkeys(bindings: ReadonlyArray<HotkeyBinding>): void {
  const bindingsRef = useRef(bindings);
  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      for (const binding of bindingsRef.current) {
        if (binding.metaOrCtrl && !(event.metaKey || event.ctrlKey)) continue;
        if (!binding.metaOrCtrl && (event.metaKey || event.ctrlKey)) continue;
        if (event.altKey) continue;
        const keyMatches =
          binding.key.length === 1
            ? event.key.toLocaleLowerCase() === binding.key.toLocaleLowerCase()
            : event.key === binding.key;
        if (!keyMatches) continue;
        if (!binding.allowInInputs && isEditableTarget(event.target)) continue;
        binding.handler(event);
        break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
