import { Api } from "teleproto";

import type { ChatFolderDto } from "../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";

/**
 * Dialog facts the folder rules need, extracted from a teleproto `Dialog` so
 * the membership mapping stays unit-testable without a Telegram client.
 */
export interface FolderDialogFacts {
  /** Bare peer id (decimal string), matching `mapDialogFilter` peer ids. */
  readonly peerId: string;
  readonly isUser: boolean;
  readonly isGroup: boolean;
  /** Broadcast channel: a channel that is not a megagroup. */
  readonly isBroadcast: boolean;
  readonly isBot: boolean;
  readonly isContact: boolean;
  readonly muted: boolean;
  readonly unreadCount: number;
  readonly archived: boolean;
}

/** Folder rule set normalized from `Api.DialogFilter` into plain data. */
export interface ChatFolderFilter {
  readonly id: number;
  readonly title: string;
  readonly contacts: boolean;
  readonly nonContacts: boolean;
  readonly groups: boolean;
  readonly broadcasts: boolean;
  readonly bots: boolean;
  readonly excludeMuted: boolean;
  readonly excludeRead: boolean;
  readonly includePeerIds: ReadonlyArray<string>;
  readonly excludePeerIds: ReadonlyArray<string>;
}

/**
 * Normalizes a Telegram dialog filter. Returns null for
 * `DialogFilterDefault`, which is not a real folder but Telegram's marker
 * for the implicit "All chats" view the client renders on its own.
 */
export function mapDialogFilter(
  filter: Api.TypeDialogFilter,
): ChatFolderFilter | null {
  if (!(filter instanceof Api.DialogFilter)) return null;
  return {
    id: filter.id,
    title: filter.title.text,
    contacts: Boolean(filter.contacts),
    nonContacts: Boolean(filter.nonContacts),
    groups: Boolean(filter.groups),
    broadcasts: Boolean(filter.broadcasts),
    bots: Boolean(filter.bots),
    excludeMuted: Boolean(filter.excludeMuted),
    excludeRead: Boolean(filter.excludeRead),
    // Pinned peers are folder members Telegram pins to the folder's top.
    includePeerIds: [...filter.pinnedPeers, ...filter.includePeers]
      .map(inputPeerId)
      .filter((id): id is string => id !== null),
    excludePeerIds: filter.excludePeers
      .map(inputPeerId)
      .filter((id): id is string => id !== null),
  };
}

/**
 * The custom folder a dialog belongs to, or null when it sits in the main
 * list. Archived dialogs live in the Archive (`ARCHIVE_FOLDER_ID`) and are
 * never evaluated against custom filters, which also covers each filter's
 * `excludeArchived` flag. When several filters match, the first one wins —
 * the contract models a single folder membership per chat.
 */
export function dialogFolderId(
  facts: FolderDialogFacts,
  filters: ReadonlyArray<ChatFolderFilter>,
): number | null {
  if (facts.archived) return ARCHIVE_FOLDER_ID;
  const matching = filters.find((filter) => folderIncludes(filter, facts));
  return matching ? matching.id : null;
}

/**
 * Builds the workspace folder list: one entry per custom filter, plus the
 * Archive when it holds at least one chat. Unread counts sum the unread
 * counts of each folder's member dialogs, mirroring Telegram's folder badge.
 */
export function buildChatFolders(
  filters: ReadonlyArray<ChatFolderFilter>,
  dialogs: ReadonlyArray<FolderDialogFacts>,
): ReadonlyArray<ChatFolderDto> {
  const folders = new Map<number, ChatFolderDto>(
    filters.map((filter) => [
      filter.id,
      { id: filter.id, title: filter.title, unreadCount: 0 },
    ]),
  );
  let archivedChats = 0;
  let archivedUnread = 0;
  for (const dialog of dialogs) {
    const folderId = dialogFolderId(dialog, filters);
    if (folderId === ARCHIVE_FOLDER_ID) {
      archivedChats += 1;
      archivedUnread += dialog.unreadCount;
      continue;
    }
    const folder = folderId === null ? undefined : folders.get(folderId);
    if (folder && folderId !== null) {
      folders.set(folderId, {
        ...folder,
        unreadCount: folder.unreadCount + dialog.unreadCount,
      });
    }
  }
  const result = [...folders.values()];
  if (archivedChats > 0) {
    result.push({
      id: ARCHIVE_FOLDER_ID,
      title: "Archive",
      unreadCount: archivedUnread,
    });
  }
  return result;
}

function folderIncludes(
  filter: ChatFolderFilter,
  facts: FolderDialogFacts,
): boolean {
  // An explicit exclusion wins over every inclusion rule.
  if (filter.excludePeerIds.includes(facts.peerId)) return false;
  const included =
    filter.includePeerIds.includes(facts.peerId) ||
    (filter.contacts && facts.isUser && facts.isContact && !facts.isBot) ||
    (filter.nonContacts && facts.isUser && !facts.isContact && !facts.isBot) ||
    (filter.bots && facts.isBot) ||
    (filter.groups && facts.isGroup) ||
    (filter.broadcasts && facts.isBroadcast);
  if (!included) return false;
  if (filter.excludeRead && facts.unreadCount === 0) return false;
  if (filter.excludeMuted && facts.muted) return false;
  return true;
}

function inputPeerId(peer: Api.TypeInputPeer): string | null {
  if (peer instanceof Api.InputPeerUser) return peer.userId.toString();
  if (peer instanceof Api.InputPeerChat) return peer.chatId.toString();
  if (peer instanceof Api.InputPeerChannel) return peer.channelId.toString();
  // Self and empty peers never name a folder member.
  return null;
}
