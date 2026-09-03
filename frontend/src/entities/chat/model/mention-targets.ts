import type {
  ChatDto,
  ChatMemberDto,
  MessageDto,
} from "../../../../../contracts/src/ipc";

/** A person or chat the agent conversation can name with `@`. */
export interface MentionTarget {
  readonly kind: "person" | "chat";
  /** Peer id for a person, chat id for a chat. */
  readonly id: string;
  /** The exact spelling the agent payload and replies use. */
  readonly name: string;
  readonly handle: string | null;
  readonly avatarUrl: string | null;
  readonly avatarPending: boolean;
}

export interface MentionTargetSources {
  readonly chats: ReadonlyArray<ChatDto>;
  /** Loaded messages of the open chat; their authors are people in scope. */
  readonly messages: ReadonlyArray<MessageDto>;
  /** Settled photos from `chat-avatar` events, keyed by peer id. */
  readonly peerAvatars: Readonly<Record<string, string | null>>;
  /** Members of the open chat when the list has loaded. */
  readonly members: ReadonlyArray<ChatMemberDto>;
}

/**
 * Everyone the agent can be talking about: authors of the loaded messages,
 * members of the open chat, and the chats themselves. Deduplicated by name
 * so a reply's `@Lev` resolves to exactly one card; the first source to
 * name someone wins, with members ahead of authors because members carry a
 * handle for the picker.
 */
export function buildMentionTargets({
  chats,
  messages,
  peerAvatars,
  members,
}: MentionTargetSources): ReadonlyArray<MentionTarget> {
  const byName = new Map<string, MentionTarget>();
  const add = (target: MentionTarget): void => {
    const key = target.name.trim().toLocaleLowerCase();
    if (!key || byName.has(key)) return;
    byName.set(key, { ...target, name: target.name.trim() });
  };
  const settledAvatar = (
    id: string,
    snapshot: string | null,
    pending: boolean | undefined,
  ): Pick<MentionTarget, "avatarUrl" | "avatarPending"> => {
    const settled = peerAvatars[id];
    return settled === undefined
      ? { avatarUrl: snapshot, avatarPending: pending ?? false }
      : { avatarUrl: settled, avatarPending: false };
  };

  for (const member of members) {
    add({
      kind: "person",
      id: member.id,
      name: member.displayName,
      handle: member.username,
      ...settledAvatar(member.id, member.avatarDataUrl, member.avatarPending),
    });
  }
  for (const message of messages) {
    // Outgoing rows and unacknowledged placeholders carry no peer id.
    if (message.outgoing || !message.senderId) continue;
    add({
      kind: "person",
      id: message.senderId,
      name: message.senderName,
      handle: null,
      ...settledAvatar(
        message.senderId,
        message.senderAvatarUrl,
        message.senderAvatarPending,
      ),
    });
  }
  for (const chat of chats) {
    add({
      kind: "chat",
      id: chat.id,
      name: chat.title,
      handle: null,
      ...settledAvatar(chat.id, chat.avatarDataUrl, chat.avatarPending),
    });
  }
  return [...byName.values()];
}
