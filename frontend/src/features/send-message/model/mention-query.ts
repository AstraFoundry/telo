import type { ChatMemberDto } from "../../../../../contracts/src/ipc";
import { filterMentionItems, type MentionItem } from "shared/lib/mention-query";

export { mentionQueryAtCaret } from "shared/lib/mention-query";
export type { MentionQuery } from "shared/lib/mention-query";

/** A group member as a mention-picker row; keeps the member for the insert. */
export interface MemberMentionItem extends MentionItem {
  readonly member: ChatMemberDto;
}

/**
 * Members the composer can mention: only accounts with a username, since the
 * toolbar authors `mention` entities (`@username`) and not `text-mention`.
 */
export function filterMentionMembers(
  members: ReadonlyArray<ChatMemberDto>,
  query: string,
): MemberMentionItem[] {
  const items = members.flatMap((member) =>
    member.username
      ? [
          {
            id: member.id,
            label: member.displayName,
            description: `@${member.username}`,
            avatarUrl: member.avatarDataUrl,
            avatarPending: member.avatarPending,
            ...(member.avatarPlaceholder
              ? { avatarPlaceholder: member.avatarPlaceholder }
              : {}),
            member,
          },
        ]
      : [],
  );
  return filterMentionItems(items, query);
}

/** The inserted token plus a trailing space; the mention entity covers only `@username`. */
export function mentionInsert(username: string): {
  readonly text: string;
  readonly entity: {
    readonly type: "mention";
    readonly offset: number;
    readonly length: number;
  };
} {
  const token = `@${username}`;
  return {
    text: `${token} `,
    entity: { type: "mention", offset: 0, length: token.length },
  };
}
