import type { ChatMemberDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { OptionRow } from "shared/ui";

export interface MentionAutocompleteProps {
  /** Ties the listbox to the composer's `aria-controls`. */
  readonly id: string;
  readonly members: ReadonlyArray<ChatMemberDto>;
  readonly activeIndex: number;
  onHover(index: number): void;
  onPick(member: ChatMemberDto): void;
}

/**
 * Identifies one suggestion so the composer can point `aria-activedescendant`
 * at it. Keyed by position rather than member id: the active option is tracked
 * by index, and the list is rebuilt per query anyway.
 */
export function mentionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/** Listbox of group members for the in-progress `@` query in the composer. */
export function MentionAutocomplete({
  id,
  members,
  activeIndex,
  onHover,
  onPick,
}: MentionAutocompleteProps) {
  if (members.length === 0) return null;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={copy.mentionSuggestions}
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-column"
    >
      {members.map((member, index) => {
        const active = index === activeIndex;
        return (
          <li key={member.id} role="presentation">
            <OptionRow
              id={mentionOptionId(id, index)}
              role="option"
              aria-selected={active}
              // Focus stays in the textarea and moves via aria-activedescendant,
              // so the rows must not become their own tab stops.
              tabIndex={-1}
              layout="inline"
              active={active}
              label={member.displayName}
              description={`@${member.username}`}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(member)}
            />
          </li>
        );
      })}
    </ul>
  );
}
