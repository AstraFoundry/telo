import {
  type KeyboardEvent,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  filterMentionItems,
  type MentionItem,
  mentionQueryAtCaret,
} from "shared/lib/mention-query";
import { mentionOptionId } from "shared/ui";

export interface MentionPicker<T extends MentionItem> {
  readonly value: string;
  setValue(next: string): void;
  readonly inputRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly listboxId: string;
  readonly matches: ReadonlyArray<T>;
  readonly activeIndex: number;
  setActiveIndex(index: number): void;
  pick(item: T): void;
  /** Spread onto the textarea; wires caret tracking, keys and ARIA. */
  readonly textareaProps: {
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
    onSelect(event: SyntheticEvent<HTMLTextAreaElement>): void;
    "aria-autocomplete": "list";
    "aria-controls": string | undefined;
    "aria-activedescendant": string | undefined;
  };
}

/**
 * `@` completion for a plain textarea over display names: the query may span
 * words, the list closes by itself when nothing matches, Escape dismisses it
 * for the current `@`, and a pick writes `@Name ` where the query was. The
 * caret is tracked from the element so the query follows clicks and arrow
 * keys, not only typing.
 */
export function useMentionPicker<T extends MentionItem>(
  items: ReadonlyArray<T>,
): MentionPicker<T> {
  const [value, setValueState] = useState("");
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const listboxId = useId();

  const query = mentionQueryAtCaret(value, caret, { allowSpaces: true });
  const queryKey = query ? `${query.start}:${query.query}` : null;
  const [previousKey, setPreviousKey] = useState(queryKey);
  if (queryKey !== previousKey) {
    setPreviousKey(queryKey);
    setActiveIndex(0);
  }
  const matches =
    query && dismissedAt !== query.start ? matching(query.query) : [];

  // A name followed by a space is a finished mention, not a query for it:
  // reopening would make Enter re-complete instead of sending the prompt.
  function matching(raw: string): T[] {
    const trimmed = raw.trimEnd();
    const closed =
      trimmed !== raw &&
      items.some(
        (item) =>
          item.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      );
    return closed ? [] : filterMentionItems(items, trimmed);
  }
  const open = matches.length > 0;
  const active = Math.min(activeIndex, Math.max(matches.length - 1, 0));

  // A programmatic edit lands in the DOM on the next render; the caret is
  // placed then, after React has written the new value.
  useEffect(() => {
    const target = pendingCaret.current;
    const textarea = inputRef.current;
    if (target === null || !textarea) return;
    pendingCaret.current = null;
    textarea.setSelectionRange(target, target);
    textarea.focus({ preventScroll: true });
  });

  const setValue = (next: string): void => {
    setValueState(next);
    const textarea = inputRef.current;
    setCaret(textarea ? textarea.selectionEnd : next.length);
  };

  const pick = (item: T): void => {
    if (!query) return;
    const token = `@${item.label} `;
    const next = value.slice(0, query.start) + token + value.slice(caret);
    const position = query.start + token.length;
    pendingCaret.current = position;
    setValueState(next);
    setCaret(position);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!open || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((active + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((active - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(matches[active]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(query!.start);
    }
  };

  return {
    value,
    setValue,
    inputRef,
    listboxId,
    matches,
    activeIndex: active,
    setActiveIndex,
    pick,
    textareaProps: {
      onKeyDown,
      onSelect: (event) => setCaret(event.currentTarget.selectionEnd),
      "aria-autocomplete": "list",
      "aria-controls": open ? listboxId : undefined,
      "aria-activedescendant": open
        ? mentionOptionId(listboxId, active)
        : undefined,
    },
  };
}
