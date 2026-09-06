import type { MentionTarget } from "entities/chat";
import type { MentionItem } from "shared/lib/mention-query";

/** A mention target as a picker row; keeps the target for the chip. */
export interface TargetMentionItem extends MentionItem {
  readonly target: MentionTarget;
}

/**
 * People first, then chats: the composer completes a person's display name
 * (what the agent payload and replies use), with the handle as the trailing
 * detail when the member has one.
 */
export function toMentionItems(
  targets: ReadonlyArray<MentionTarget>,
): TargetMentionItem[] {
  const people = targets.filter((target) => target.kind === "person");
  const chats = targets.filter((target) => target.kind === "chat");
  return [...people, ...chats].map((target) => ({
    id: `${target.kind}:${target.id}`,
    label: target.name,
    description: target.handle ? `@${target.handle}` : null,
    avatarUrl: target.avatarUrl,
    avatarPending: target.avatarPending,
    ...(target.avatarPlaceholder
      ? { avatarPlaceholder: target.avatarPlaceholder }
      : {}),
    target,
  }));
}

/** Lookup for reply rendering, keyed the way `parseReply` canonicalises names. */
export function indexMentionTargets(
  targets: ReadonlyArray<MentionTarget>,
): ReadonlyMap<string, MentionTarget> {
  return new Map(
    targets.map((target) => [target.name.toLocaleLowerCase(), target]),
  );
}
