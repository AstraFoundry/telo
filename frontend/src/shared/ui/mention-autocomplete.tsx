import { copy } from "@/shared/config/copy";
import type { MentionItem } from "@/shared/lib/mention-query";

import { Avatar } from "./avatar";
import { OptionRow } from "./option-row";

export interface MentionAutocompleteProps<T extends MentionItem> {
  /** Ties the listbox to the composer's `aria-controls`. */
  readonly id: string;
  readonly items: ReadonlyArray<T>;
  readonly activeIndex: number;
  onHover(index: number): void;
  onPick(item: T): void;
}

/**
 * Identifies one suggestion so the composer can point `aria-activedescendant`
 * at it. Keyed by position rather than item id: the active option is tracked
 * by index, and the list is rebuilt per query anyway.
 */
export function mentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * Listbox for an in-progress `@` query, anchored above the composer that
 * owns it. Every row carries the peer's photo so a name is recognisable at a
 * glance; a missing photo paints the TDLib empty userpic when one is known.
 */
export function MentionAutocomplete<T extends MentionItem>({
  id,
  items,
  activeIndex,
  onHover,
  onPick,
}: MentionAutocompleteProps<T>) {
  if (items.length === 0) return null;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={copy.mentionSuggestions}
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-column"
    >
      {items.map((item, index) => {
        const active = index === activeIndex;
        return (
          <li key={item.id} role="presentation">
            <OptionRow
              id={mentionOptionId(id, index)}
              role="option"
              aria-selected={active}
              // Focus stays in the textarea and moves via aria-activedescendant,
              // so the rows must not become their own tab stops.
              tabIndex={-1}
              layout="inline"
              active={active}
              leading={
                <Avatar
                  src={item.avatarUrl}
                  pending={item.avatarPending}
                  placeholder={item.avatarPlaceholder}
                  className="size-6"
                />
              }
              label={item.label}
              description={item.description ?? undefined}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(item)}
            />
          </li>
        );
      })}
    </ul>
  );
}
