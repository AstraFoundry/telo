import type { ChatMemberDto } from "../../../../../contracts/src/ipc";

export interface MentionQuery {
  /** UTF-16 offset of the triggering `@`. */
  readonly start: number;
  /** Text after `@` up to the caret; empty while the user just typed `@`. */
  readonly query: string;
}

/**
 * Returns the in-progress `@mention` at `caret` when the `@` starts a token
 * (start of string or after whitespace) and the query is username characters.
 * Completed mentions (followed by a space) and mid-word `@` do not match.
 */
export function mentionQueryAtCaret(
  body: string,
  caret: number,
): MentionQuery | null {
  if (caret < 0 || caret > body.length) return null;
  const before = body.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  if (!/^[A-Za-z0-9_]*$/.test(query)) return null;
  return { start: at, query };
}

/**
 * Members the composer can mention: only accounts with a username, since the
 * toolbar authors `mention` entities (`@username`) and not `text-mention`.
 */
export function filterMentionMembers(
  members: ReadonlyArray<ChatMemberDto>,
  query: string,
): ChatMemberDto[] {
  const needle = query.toLocaleLowerCase();
  return members.filter((member) => {
    if (!member.username) return false;
    return (
      member.username.toLocaleLowerCase().startsWith(needle) ||
      member.displayName.toLocaleLowerCase().includes(needle)
    );
  });
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
