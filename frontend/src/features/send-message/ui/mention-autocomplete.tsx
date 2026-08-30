import type { ChatMemberDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { OptionRow } from "shared/ui";

export interface MentionAutocompleteProps {
  readonly members: ReadonlyArray<ChatMemberDto>;
  readonly activeIndex: number;
  onHover(index: number): void;
  onPick(member: ChatMemberDto): void;
}

/** Listbox of group members for the in-progress `@` query in the composer. */
export function MentionAutocomplete({
  members,
  activeIndex,
  onHover,
  onPick,
}: MentionAutocompleteProps) {
  if (members.length === 0) return null;
  return (
    <ul
      role="listbox"
      aria-label={copy.mentionSuggestions}
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-column"
    >
      {members.map((member, index) => {
        const active = index === activeIndex;
        return (
          <li key={member.id} role="presentation">
            <OptionRow
              role="option"
              aria-selected={active}
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
