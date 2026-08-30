import { Api } from "teleproto";
import { describe, expect, it } from "vitest";

import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";

import {
  buildChatFolders,
  dialogFolderId,
  mapDialogFilter,
  type ChatFolderFilter,
  type FolderDialogFacts,
} from "./teleproto-folders";

type InputPeerConstructor =
  | typeof Api.InputPeerUser
  | typeof Api.InputPeerChat
  | typeof Api.InputPeerChannel;

function inputPeer(
  ctor: InputPeerConstructor,
  fields: Record<string, number>,
): Api.TypeInputPeer {
  // Telegram ids are 64-bit; small test fixtures fit plain numbers.
  return new ctor(fields as never);
}

function dialogFilter(
  partial: Partial<Api.DialogFilter> & { readonly id: number },
): Api.DialogFilter {
  return new Api.DialogFilter({
    title: new Api.TextWithEntities({ text: "Folder", entities: [] }),
    pinnedPeers: [],
    includePeers: [],
    excludePeers: [],
    ...partial,
  } as unknown as ConstructorParameters<typeof Api.DialogFilter>[0]);
}

function folder(partial: Partial<ChatFolderFilter> = {}): ChatFolderFilter {
  return {
    id: 2,
    title: "Work",
    contacts: false,
    nonContacts: false,
    groups: false,
    broadcasts: false,
    bots: false,
    excludeMuted: false,
    excludeRead: false,
    includePeerIds: [],
    excludePeerIds: [],
    ...partial,
  };
}

function facts(partial: Partial<FolderDialogFacts> = {}): FolderDialogFacts {
  return {
    peerId: "100",
    isUser: true,
    isGroup: false,
    isBroadcast: false,
    isBot: false,
    isContact: false,
    muted: false,
    unreadCount: 0,
    archived: false,
    ...partial,
  };
}

describe("mapDialogFilter", () => {
  it("normalizes flags, title, and member peer ids", () => {
    const filter = mapDialogFilter(
      dialogFilter({
        id: 3,
        groups: true,
        excludeRead: true,
        pinnedPeers: [
          inputPeer(Api.InputPeerUser, { userId: 11, accessHash: 0 }),
        ],
        includePeers: [inputPeer(Api.InputPeerChat, { chatId: 22 })],
        excludePeers: [
          inputPeer(Api.InputPeerChannel, { channelId: 33, accessHash: 0 }),
        ],
      }),
    );

    expect(filter).toEqual({
      id: 3,
      title: "Folder",
      contacts: false,
      nonContacts: false,
      groups: true,
      broadcasts: false,
      bots: false,
      excludeMuted: false,
      excludeRead: true,
      includePeerIds: ["11", "22"],
      excludePeerIds: ["33"],
    });
  });

  it("drops DialogFilterDefault, which marks the implicit All chats view", () => {
    expect(mapDialogFilter(new Api.DialogFilterDefault())).toBeNull();
  });
});

describe("dialogFolderId", () => {
  it("maps archived chats to the Archive folder", () => {
    expect(
      dialogFolderId(facts({ archived: true }), [folder({ groups: true })]),
    ).toBe(ARCHIVE_FOLDER_ID);
  });

  it("matches explicit includes, including peers pinned inside the folder", () => {
    const work = folder({ id: 2, includePeerIds: ["100"] });
    expect(dialogFolderId(facts(), [work])).toBe(2);
  });

  it.each([
    ["contacts", facts({ isContact: true })],
    ["nonContacts", facts({ isContact: false })],
    ["bots", facts({ isBot: true })],
    ["groups", facts({ isUser: false, isGroup: true })],
    ["broadcasts", facts({ isUser: false, isBroadcast: true })],
  ] as const)("matches the %s flag", (flag, dialog) => {
    const work = folder({ [flag]: true });
    expect(dialogFolderId(dialog, [work])).toBe(2);
  });

  it("does not match contacts/nonContacts for bots", () => {
    const work = folder({ contacts: true, nonContacts: true });
    expect(
      dialogFolderId(facts({ isBot: true, isContact: true }), [work]),
    ).toBeNull();
  });

  it("lets an explicit exclusion win over every inclusion rule", () => {
    const work = folder({ includePeerIds: ["100"], excludePeerIds: ["100"] });
    expect(dialogFolderId(facts(), [work])).toBeNull();
  });

  it("trims read and muted chats when the filter excludes them", () => {
    // Trim rules apply to members; the fixtures include the dialog first.
    const unreadOnly = folder({ excludeRead: true, includePeerIds: ["100"] });
    expect(dialogFolderId(facts({ unreadCount: 0 }), [unreadOnly])).toBeNull();
    expect(dialogFolderId(facts({ unreadCount: 4 }), [unreadOnly])).toBe(2);
    const unmutedOnly = folder({ excludeMuted: true, includePeerIds: ["100"] });
    expect(dialogFolderId(facts({ muted: true }), [unmutedOnly])).toBeNull();
  });

  it("reports the first matching filter when several match", () => {
    const first = folder({ id: 2, groups: true });
    const second = folder({ id: 3, groups: true });
    expect(
      dialogFolderId(facts({ isUser: false, isGroup: true }), [first, second]),
    ).toBe(2);
  });

  it("returns null when no filter matches", () => {
    expect(dialogFolderId(facts(), [folder({ groups: true })])).toBeNull();
  });
});

describe("buildChatFolders", () => {
  it("sums unread counts per folder and appends a non-empty Archive", () => {
    const folders = buildChatFolders(
      [folder({ id: 2, includePeerIds: ["100"] })],
      [
        facts({ peerId: "100", unreadCount: 3 }),
        facts({ peerId: "200", unreadCount: 5 }),
        facts({ peerId: "300", unreadCount: 2, archived: true }),
      ],
    );

    expect(folders).toEqual([
      { id: 2, title: "Work", unreadCount: 3 },
      { id: ARCHIVE_FOLDER_ID, title: "Archive", unreadCount: 2 },
    ]);
  });

  it("omits the Archive when no chat is archived", () => {
    expect(buildChatFolders([folder({ id: 2 })], [facts()])).toEqual([
      { id: 2, title: "Work", unreadCount: 0 },
    ]);
  });
});
