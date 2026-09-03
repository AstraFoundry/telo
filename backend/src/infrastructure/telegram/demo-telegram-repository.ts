import path from "node:path";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";

import type {
  BotCallbackAnswerDto,
  ChatDto,
  ChatFolderDto,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GlobalSearchResultDto,
  MessageDto,
  MessageEntityDto,
  MessageMediaDto,
  MessagePageDto,
  MessagePageInput,
  MessageReplyToDto,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  StickerFormat,
  StickerItemDto,
  StickerSetDto,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import { ARCHIVE_FOLDER_ID } from "../../../../contracts/src/ipc";
import type {
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";
import {
  demoImagePng,
  demoStickerTgs,
  demoVideoWebm,
} from "./demo-media-assets";
import {
  MEDIA_CACHE_MAX_BYTES,
  enforceMediaCacheLimit,
  touchMediaCacheFile,
} from "./media-cache";

// The demo workspace ships one custom folder so dev and E2E can exercise
// folder tabs, per-folder unread badges, and the Archive deterministically.
const DEMO_WORK_FOLDER_ID = 2;
const DEMO_WORK_FOLDER_TITLE = "Work";

// Shared media is the photo/video/file slice of a chat's history; link
// previews and non-visual documents (audio, stickers, …) stay out.
const SHARED_MEDIA_KINDS = new Set(["photo", "video", "file"]);

// Stands in for Telegram's stripped thumbnail: a 2x2 solid-grey JPEG, small
// enough to inline and real enough for the renderer to decode, so the demo
// workspace exercises the blurred placeholder without a Telegram connection.
const DEMO_BLURRED_THUMBNAIL =
  "data:image/jpeg;base64,/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z";

const INITIAL_CHATS: ReadonlyArray<ChatDto> = [
  {
    id: "saved",
    title: "Saved Messages",
    preview: "Release checklist",
    updatedAt: "2026-08-27T15:42:00.000Z",
    unreadCount: 0,
    lastReadMessageId: "saved-1",
    muted: false,
    pinned: true,
    kind: "saved",
    initials: "SM",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: null,
  },
  {
    id: "design",
    title: "Telo Design",
    preview: "Ship both with the next build.",
    updatedAt: "2026-08-27T14:32:00.000Z",
    unreadCount: 3,
    lastReadMessageId: "design-3",
    muted: false,
    pinned: true,
    kind: "group",
    initials: "TD",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: DEMO_WORK_FOLDER_ID,
  },
  {
    id: "product",
    title: "Product Notes",
    preview: "Agent context is ready for review.",
    updatedAt: "2026-08-26T10:24:00.000Z",
    unreadCount: 0,
    lastReadMessageId: "product-1",
    muted: true,
    pinned: false,
    kind: "channel",
    initials: "PN",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: DEMO_WORK_FOLDER_ID,
  },
  {
    // Telegram's Archive is folder id 1: archived chats stay out of the
    // main list and surface only under the Archive tab. The chat is direct
    // and online so the header's presence line has deterministic demo data.
    id: "offsite",
    title: "Offsite Planning",
    preview: "Book the venue before Friday.",
    updatedAt: "2026-08-25T09:12:00.000Z",
    unreadCount: 2,
    lastReadMessageId: "offsite-1",
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "OP",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    presence: "online",
    folderId: ARCHIVE_FOLDER_ID,
  },
  {
    // The bot chat. Bots are the only peers that attach inline keyboards, so
    // this dialog is where the demo workspace exercises them: both of its
    // messages carry one, together covering every button kind and every
    // callback answer shape.
    id: "telobot",
    title: "Telo Bot",
    preview: "Build 482 finished: 12 tests, 0 failures.",
    updatedAt: "2026-08-24T08:05:00.000Z",
    unreadCount: 0,
    lastReadMessageId: "telobot-2",
    muted: false,
    pinned: false,
    kind: "direct",
    initials: "TB",
    avatarDataUrl: null,
    draftPreview: null,
    typing: false,
    folderId: null,
  },
];

// Demo auto-reply copy, keyed by chat id; falls back to a generic reply for
// any chat added later (e.g. by forwardMessage into a new target).
const DEMO_AUTO_REPLIES: Record<string, string> = {
  design: "Looks good — shipping it.",
  product: "Noted, added to the review doc.",
};

// The peers behind the message senders, keyed by the `senderId` the message
// fixtures carry. These accounts have no dialog of their own, so a peer
// lookup is the only way to see them: names and usernames match the senders
// across the fixtures, bios stand in for Telegram's "about" text, and a
// single peer shares a phone number so both branches of the identity card
// have deterministic demo coverage.
interface DemoPeer {
  readonly displayName: string;
  readonly username: string | null;
  readonly bio: string | null;
  readonly phone: string | null;
}

const DEMO_PEERS: Record<string, DemoPeer> = {
  "demo-mina": {
    displayName: "Mina",
    username: "mina",
    bio: "Design systems, spacing rules, and long changelogs.",
    phone: "+1 555 0142",
  },
  "demo-aron": {
    displayName: "Aron",
    username: "aron",
    bio: "Collects reference shots for the media viewer.",
    phone: null,
  },
  "demo-lev": {
    displayName: "Lev",
    username: "lev",
    bio: "Breaks the retry flow on purpose, then files it.",
    phone: null,
  },
  "demo-priya": {
    displayName: "Priya",
    username: "priya",
    bio: "Offsite logistics: venues, travel, and hard deadlines.",
    phone: null,
  },
};

// Group members backing the composer's mention autocomplete, listed as peer
// ids so a mention and a peer lookup always report the same identity. Chats
// without an entry (direct, channel, Saved Messages) report no members, so
// the autocomplete honestly stays closed there.
const DEMO_CHAT_MEMBERS: Record<string, ReadonlyArray<ChatMemberDto>> = {
  design: demoMembers("demo-mina", "demo-aron", "demo-lev"),
};

function demoMembers(
  ...peerIds: ReadonlyArray<string>
): ReadonlyArray<ChatMemberDto> {
  return peerIds.map((id) => ({
    id,
    displayName: DEMO_PEERS[id].displayName,
    username: DEMO_PEERS[id].username,
  }));
}

// The demo account's own peer. Saved Messages is the chat with oneself, so its
// id is what outgoing rows carry as their author peer, keying the account's
// photo in the avatar cache.
const DEMO_ACCOUNT_PEER_ID = "saved";

// Stands in for Telegram's decoded vector thumbnail, so the demo workspace
// exercises the silhouette placeholder the live adapter derives per document.
const DEMO_STICKER_OUTLINE_PATH = "M64,64L448,64L448,448L64,448z";

// Pinned message ids per chat, most recently pinned first (Telegram's pinned
// order). Kept separate from the message fixtures so the profile panel's
// pinned section and its click-to-jump have deterministic content.
const INITIAL_PINNED_MESSAGE_IDS: Record<string, ReadonlyArray<string>> = {
  design: ["design-6", "design-1"],
};

const INITIAL_MESSAGES: Record<string, ReadonlyArray<MessageDto>> = {
  saved: [
    {
      id: "saved-1",
      chatId: "saved",
      senderName: "You",
      senderId: DEMO_ACCOUNT_PEER_ID,
      senderAvatarUrl: null,
      body: "Release checklist: tests, docs, signed packages.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T15:42:00.000Z",
      outgoing: true,
      status: "read",
    },
  ],
  design: [
    {
      id: "design-1",
      chatId: "design",
      senderName: "Mina",
      senderId: "demo-mina",
      senderAvatarUrl: null,
      body: "The conversation list should stay compact at desktop widths.",
      entities: [{ type: "bold", offset: 34, length: 7 }],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:12:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-2",
      chatId: "design",
      senderName: "You",
      senderId: DEMO_ACCOUNT_PEER_ID,
      senderAvatarUrl: null,
      body: "Agreed. Keep the composer anchored and let only the message list scroll.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:18:00.000Z",
      outgoing: true,
      status: "read",
    },
    {
      id: "design-3",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "This write-up nails the spacing rules: https://example.com/spacing-craft",
      entities: [{ type: "url", offset: 39, length: 33 }],
      media: {
        id: "design/3",
        kind: "webpage",
        url: "https://example.com/spacing-craft",
        displayUrl: "example.com/spacing-craft",
        siteName: "Example Journal",
        title: "Spacing is a system, not a vibe",
        description:
          "Why consistent rhythm beats one-off tweaks in dense desktop interfaces.",
        thumbnailMediaId: null,
      },
      groupedId: null,
      sentAt: "2026-08-27T14:26:00.000Z",
      outgoing: false,
      status: "read",
    },
    // Everything past the read boundary (`lastReadMessageId: "design-3"`) is
    // unread — the three-message gap matches the chat's unreadCount and gives
    // the unread divider a deterministic placement for E2E.
    // Received media fixtures sit inside the read range so the media viewer,
    // album grid, and thumbnail preload have deterministic content without
    // shifting the unread divider.
    {
      id: "design-media-1",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "design/media-1",
        kind: "photo",
        fileName: "telo-hero.png",
        mimeType: "image/png",
        size: null,
        width: 640,
        height: 480,
        duration: null,
        spoiler: false,
        blurredThumbnail: DEMO_BLURRED_THUMBNAIL,
      },
      groupedId: null,
      sentAt: "2026-08-27T14:27:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-media-2",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "design/media-2",
        kind: "video",
        fileName: "telo-demo.webm",
        mimeType: "video/webm",
        size: null,
        width: 96,
        height: 96,
        duration: 1,
        spoiler: false,
        blurredThumbnail: DEMO_BLURRED_THUMBNAIL,
      },
      groupedId: null,
      sentAt: "2026-08-27T14:27:10.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-media-3",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "Reference shots for the viewer work.",
      entities: [],
      media: {
        id: "design/media-3",
        kind: "photo",
        fileName: "telo-album-one.png",
        mimeType: "image/png",
        size: null,
        width: 640,
        height: 480,
        duration: null,
        spoiler: false,
        blurredThumbnail: DEMO_BLURRED_THUMBNAIL,
      },
      groupedId: "demo-album-1",
      sentAt: "2026-08-27T14:27:20.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-media-4",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "design/media-4",
        kind: "photo",
        fileName: "telo-album-two.png",
        mimeType: "image/png",
        size: null,
        width: 640,
        height: 480,
        duration: null,
        spoiler: false,
        blurredThumbnail: DEMO_BLURRED_THUMBNAIL,
      },
      groupedId: "demo-album-1",
      sentAt: "2026-08-27T14:27:20.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-media-5",
      chatId: "design",
      senderName: "Aron",
      senderId: "demo-aron",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "design/media-5",
        kind: "photo",
        fileName: "telo-album-three.png",
        mimeType: "image/png",
        size: null,
        width: 640,
        height: 480,
        duration: null,
        spoiler: false,
        blurredThumbnail: DEMO_BLURRED_THUMBNAIL,
      },
      groupedId: "demo-album-1",
      sentAt: "2026-08-27T14:27:20.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-4",
      chatId: "design",
      senderName: "Lev",
      senderId: "demo-lev",
      senderAvatarUrl: null,
      body: "The retry flow needs a failed state in the transcript.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:28:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-5",
      chatId: "design",
      senderName: "Lev",
      senderId: "demo-lev",
      senderAvatarUrl: null,
      body: "And the unread divider has to survive paging.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:30:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "design-6",
      chatId: "design",
      senderName: "Lev",
      senderId: "demo-lev",
      senderAvatarUrl: null,
      body: "Ship both with the next build.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-27T14:32:00.000Z",
      outgoing: false,
      status: "read",
    },
  ],
  product: [
    {
      id: "product-1",
      chatId: "product",
      senderName: "Telo",
      // A channel post is authored by the channel itself.
      senderId: "product",
      senderAvatarUrl: null,
      body: "Agent context is ready for review.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-26T10:24:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      // A custom emoji is a sticker document referenced from inside the text,
      // so the entity names the bare document id of the animated fixture.
      id: "product-5",
      chatId: "product",
      senderName: "Telo",
      senderId: "product",
      senderAvatarUrl: null,
      body: "Shipping 🎉",
      entities: [
        { type: "custom-emoji", offset: 9, length: 2, documentId: "2" },
      ],
      media: null,
      groupedId: null,
      sentAt: "2026-08-26T10:28:00.000Z",
      outgoing: false,
      status: "read",
    },
    // One sticker per Telegram encoding, so the transcript, the demo download
    // synthesis and the e2e sweep cover the still, Lottie and video paths
    // rather than only the still one. Telegram ships stills as WebP; the demo
    // has no WebP encoder, so it synthesizes a PNG document instead.
    {
      id: "product-2",
      chatId: "product",
      senderName: "Telo",
      senderId: "product",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "product/2",
        kind: "sticker",
        fileName: "wave.png",
        mimeType: "image/png",
        size: null,
        width: 512,
        height: 512,
        duration: null,
        spoiler: false,
        sticker: {
          emoji: "👋",
          format: "static",
          setName: "TeloPack",
          outlinePath: DEMO_STICKER_OUTLINE_PATH,
        },
      },
      groupedId: null,
      sentAt: "2026-08-26T10:25:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "product-3",
      chatId: "product",
      senderName: "Telo",
      senderId: "product",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "product/3",
        kind: "sticker",
        fileName: "wave.tgs",
        mimeType: "application/x-tgsticker",
        size: null,
        width: 512,
        height: 512,
        duration: null,
        spoiler: false,
        sticker: {
          emoji: "🎉",
          format: "animated",
          setName: "TeloPack",
          outlinePath: DEMO_STICKER_OUTLINE_PATH,
        },
      },
      groupedId: null,
      sentAt: "2026-08-26T10:26:00.000Z",
      outgoing: false,
      status: "read",
    },
    {
      id: "product-4",
      chatId: "product",
      senderName: "Telo",
      senderId: "product",
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: {
        id: "product/4",
        kind: "sticker",
        fileName: "wave.webm",
        mimeType: "video/webm",
        size: null,
        width: 512,
        height: 512,
        duration: 1,
        spoiler: false,
        sticker: {
          emoji: "🔥",
          format: "video",
          setName: "TeloPack",
          outlinePath: DEMO_STICKER_OUTLINE_PATH,
        },
      },
      groupedId: null,
      sentAt: "2026-08-26T10:27:00.000Z",
      outgoing: false,
      status: "read",
    },
  ],
  offsite: [
    {
      id: "offsite-1",
      chatId: "offsite",
      senderName: "Priya",
      senderId: "demo-priya",
      senderAvatarUrl: null,
      body: "Book the venue before Friday.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-25T09:12:00.000Z",
      outgoing: false,
      status: "read",
    },
  ],
  telobot: [
    {
      id: "telobot-1",
      chatId: "telobot",
      senderName: "Telo Bot",
      senderId: "telobot",
      senderAvatarUrl: null,
      body: "Telo Bot is watching this repository.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-24T08:00:00.000Z",
      outgoing: false,
      status: "read",
      // The two callback answers this keyboard produces are the ones the
      // newest message's keyboard cannot: a url hand-off and a silent
      // answer. Between the two messages every BotCallbackAnswerDto shape
      // has a button behind it.
      keyboard: {
        rows: [
          [
            { id: "0:0", text: "Open dashboard", kind: "callback" },
            { id: "0:1", text: "Ping", kind: "callback" },
          ],
        ],
      },
    },
    {
      id: "telobot-2",
      chatId: "telobot",
      senderName: "Telo Bot",
      senderId: "telobot",
      senderAvatarUrl: null,
      body: "Build 482 finished: 12 tests, 0 failures.",
      entities: [],
      media: null,
      groupedId: null,
      sentAt: "2026-08-24T08:05:00.000Z",
      outgoing: false,
      status: "read",
      // One keyboard per button kind: two callback buttons answering with a
      // modal and a toast, then the two the renderer services on its own
      // (url, copy) and one Telegram variant this client cannot act on.
      keyboard: {
        rows: [
          [
            { id: "0:0", text: "Approve deploy", kind: "callback" },
            { id: "0:1", text: "Watch builds", kind: "callback" },
          ],
          [
            {
              id: "1:0",
              text: "Open logs",
              kind: "url",
              url: "https://example.com/telo-bot/build/482",
            },
            {
              id: "1:1",
              text: "Copy build id",
              kind: "copy",
              copyText: "build-482",
            },
            { id: "1:2", text: "Play", kind: "unsupported" },
          ],
        ],
      },
    },
  ],
};

// What the demo bot answers a press with, keyed by message id and then by
// button id. Only callback buttons appear: a url or copy button is serviced
// by the renderer without a round trip, and an unsupported one has no action
// at all, so a press against any of them is a bug worth failing loudly.
const DEMO_BOT_CALLBACK_ANSWERS: Record<
  string,
  Record<string, BotCallbackAnswerDto>
> = {
  "telobot-1": {
    "0:0": { kind: "url", url: "https://example.com/telo-bot/dashboard" },
    // A bot that acknowledges nothing is a real answer, not a failure.
    "0:1": { kind: "none" },
  },
  "telobot-2": {
    "0:0": {
      kind: "message",
      text: "Deploy needs two approvals.",
      alert: true,
    },
    "0:1": { kind: "message", text: "Watching build alerts.", alert: false },
  },
};

// The account's single installed sticker set, backing the composer picker.
// It is the set the `product` transcript's stickers already belong to, and it
// holds one sticker per Telegram encoding so the picker exercises the still,
// Lottie and video render paths. Every entry carries the message media a send
// attaches and a download synthesizes, so a set sticker travels the same
// pipeline as one that arrived on a message.
const DEMO_STICKER_SET_SHORT_NAME = "TeloPack";

interface DemoSticker {
  readonly item: StickerItemDto;
  readonly media: MessageMediaDto;
}

const DEMO_STICKERS: ReadonlyArray<DemoSticker> = [
  demoSticker("sticker/1", "👋", "static", "wave.png", "image/png"),
  demoSticker(
    "sticker/2",
    "🎉",
    "animated",
    "party.tgs",
    "application/x-tgsticker",
  ),
  demoSticker("sticker/3", "🔥", "video", "flame.webm", "video/webm"),
];

const DEMO_STICKER_SET: StickerSetDto = {
  id: "demo-telopack",
  title: "Telo Pack",
  shortName: DEMO_STICKER_SET_SHORT_NAME,
  stickers: DEMO_STICKERS.map((sticker) => sticker.item),
  // The starting installed state; the set sheet's add/remove toggle flips it
  // per repository instance, and the picker's list follows.
  installed: true,
};

function demoSticker(
  id: string,
  emoji: string,
  format: StickerFormat,
  fileName: string,
  mimeType: string,
): DemoSticker {
  // Telegram ships every sticker at 512×512; only a video one has a duration.
  const side = 512;
  return {
    item: {
      id,
      emoji,
      format,
      width: side,
      height: side,
      outlinePath: DEMO_STICKER_OUTLINE_PATH,
    },
    media: {
      id,
      kind: "sticker",
      fileName,
      mimeType,
      size: null,
      width: side,
      height: side,
      duration: format === "video" ? 1 : null,
      spoiler: false,
      sticker: {
        emoji,
        format,
        setName: DEMO_STICKER_SET_SHORT_NAME,
        outlinePath: DEMO_STICKER_OUTLINE_PATH,
      },
    },
  };
}

export interface DemoTelegramRepositoryOptions {
  /** Delay before the simulated contact starts typing a reply. */
  readonly typingDelayMs?: number;
  /** Delay (from send) before the simulated contact's reply lands. */
  readonly autoReplyDelayMs?: number;
  /** Delay between simulated upload progress steps. */
  readonly uploadStepMs?: number;
  /**
   * Directory for the downloadable demo media cache. Without it,
   * `downloadMedia` / `resolveMediaFile` reject instead of writing to disk.
   */
  readonly mediaCacheDirectory?: string;
  /**
   * Reads the media-cache ceiling in bytes. Defaults to the built-in cap so
   * standalone demo repositories evict exactly like the live adapter.
   */
  readonly mediaCacheLimitBytes?: () => Promise<number>;
}

// Deterministic progress checkpoints emitted while a demo upload is in
// flight, so dev mode and E2E can watch (and cancel) uploads the way the
// teleproto adapter behaves.
const DEMO_UPLOAD_PROGRESS_STEPS = [0.25, 0.5, 0.75] as const;

// Demo-only failure simulation: a body carrying this marker is rejected on
// the first send attempt, mimicking a transient delivery drop. The failed
// bubble's Resend action retries the same body, and the second attempt goes
// through — which is what the E2E resend journey exercises.
export const DEMO_SEND_FAIL_ONCE_MARKER = "[demo-fail-once]";

export class DemoTelegramRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly chats = new Map(
    INITIAL_CHATS.map((chat) => [chat.id, { ...chat }]),
  );
  private readonly messages = new Map(
    Object.entries(INITIAL_MESSAGES).map(([chatId, messages]) => [
      chatId,
      [...messages],
    ]),
  );
  private readonly pinnedMessageIds = new Map(
    Object.entries(INITIAL_PINNED_MESSAGE_IDS).map(([chatId, ids]) => [
      chatId,
      [...ids],
    ]),
  );
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly activeUploads = new Map<string, { cancelled: boolean }>();
  private readonly activeDownloads = new Map<string, Promise<void>>();
  private readonly transientFailures = new Set<string>();
  private readonly typingDelayMs: number;
  private readonly autoReplyDelayMs: number;
  private readonly uploadStepMs: number;
  private readonly mediaCacheDirectory: string | null;
  private readonly mediaCacheLimitBytes: () => Promise<number>;
  /** Original upload paths keyed by media id, so sent media stays
   * downloadable with its true bytes after a cache eviction. */
  private readonly sentMediaSources = new Map<string, string>();
  /**
   * Messages deleted with scope "me" stay in the store (other participants
   * keep them) but are filtered out of every read this client makes.
   */
  private readonly hiddenMessageIds = new Set<string>();
  /**
   * Whether the account still has the demo sticker set installed. The set
   * sheet's add/remove action writes it, so the button's state survives
   * across calls the way an account-level install does.
   */
  private stickerSetInstalled = DEMO_STICKER_SET.installed;

  constructor(options: DemoTelegramRepositoryOptions = {}) {
    this.typingDelayMs = options.typingDelayMs ?? 500;
    this.autoReplyDelayMs = options.autoReplyDelayMs ?? 1400;
    this.uploadStepMs = options.uploadStepMs ?? 150;
    this.mediaCacheDirectory = options.mediaCacheDirectory ?? null;
    this.mediaCacheLimitBytes =
      options.mediaCacheLimitBytes ?? (async () => MEDIA_CACHE_MAX_BYTES);
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    return {
      id: "demo-user",
      displayName: "Demo User",
      username: null,
      initials: "DU",
      avatarDataUrl: null,
    };
  }

  async listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    const chats = [...this.chats.values()];
    const start = input.cursor
      ? chats.findIndex((chat) => chat.id === input.cursor?.chatId) + 1
      : 0;
    if (input.cursor && start === 0) {
      throw new Error(`Unknown chat cursor ${input.cursor.chatId}`);
    }
    const limit = input.limit ?? chats.length;
    const items = chats.slice(start, start + limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        start + items.length < chats.length && last
          ? {
              chatId: last.id,
              topMessageId: this.messages.get(last.id)?.at(-1)?.id ?? "0",
              updatedAt: last.updatedAt,
            }
          : null,
    };
  }

  async listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return this.foldersSnapshot();
  }

  // Folder unread badges sum the unread counts of the member chats, like the
  // teleproto adapter computes them from the full dialog list.
  private foldersSnapshot(): ReadonlyArray<ChatFolderDto> {
    const chats = [...this.chats.values()];
    const unreadIn = (folderId: number) =>
      chats
        .filter((chat) => chat.folderId === folderId)
        .reduce((total, chat) => total + chat.unreadCount, 0);
    const folders: ChatFolderDto[] = [
      {
        id: DEMO_WORK_FOLDER_ID,
        title: DEMO_WORK_FOLDER_TITLE,
        unreadCount: unreadIn(DEMO_WORK_FOLDER_ID),
      },
    ];
    if (chats.some((chat) => chat.folderId === ARCHIVE_FOLDER_ID)) {
      folders.push({
        id: ARCHIVE_FOLDER_ID,
        title: "Archive",
        unreadCount: unreadIn(ARCHIVE_FOLDER_ID),
      });
    }
    return folders;
  }

  async listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    this.requireChat(chatId);
    const messages = this.visibleMessages(chatId);
    const end = input.beforeMessageId
      ? messages.findIndex((message) => message.id === input.beforeMessageId)
      : messages.length;
    if (input.beforeMessageId && end === -1) {
      throw new Error(`Unknown message cursor ${input.beforeMessageId}`);
    }
    const limit = input.limit ?? messages.length;
    const start = Math.max(0, end - limit);
    const items = messages.slice(start, end);
    return {
      items,
      nextCursor: start > 0 ? (items[0]?.id ?? null) : null,
    };
  }

  // Shared media is the photo/video/file slice of the visible history,
  // paged exactly like the transcript so the profile panel can walk older
  // media with the same cursor.
  async listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    this.requireChat(chatId);
    const media = this.visibleMessages(chatId).filter(
      (message) =>
        message.media !== null &&
        message.media.kind !== "webpage" &&
        SHARED_MEDIA_KINDS.has(message.media.kind),
    );
    const end = input.beforeMessageId
      ? media.findIndex((message) => message.id === input.beforeMessageId)
      : media.length;
    if (input.beforeMessageId && end === -1) {
      throw new Error(`Unknown message cursor ${input.beforeMessageId}`);
    }
    const limit = input.limit ?? media.length;
    const start = Math.max(0, end - limit);
    const items = media.slice(start, end);
    return {
      items,
      nextCursor: start > 0 ? (items[0]?.id ?? null) : null,
    };
  }

  async listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    this.requireChat(chatId);
    // Pinned ids outlive their messages (a delete keeps the pin server-side
    // until unpinned), so the listing filters to messages that still exist.
    const visible = this.visibleMessages(chatId);
    return (this.pinnedMessageIds.get(chatId) ?? []).flatMap((id) => {
      const message = visible.find((entry) => entry.id === id);
      return message ? [message] : [];
    });
  }

  async listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    this.requireChat(chatId);
    return DEMO_CHAT_MEMBERS[chatId] ?? [];
  }

  // Identity card for any peer a message can be authored by. A peer that has
  // a dialog reports the dialog's own identity, so the card and the chat list
  // agree on title, kind, and photo; a group member or channel poster with no
  // dialog resolves from the demo peer table. Demo photos are settled by
  // construction, so the lookup never reports a pending avatar.
  async getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    const chat = this.chats.get(peerId);
    if (chat) {
      return {
        id: chat.id,
        title: chat.title,
        username: null,
        kind: chat.kind,
        avatarDataUrl: chat.avatarDataUrl,
        bio: null,
        phone: null,
      };
    }
    const peer = DEMO_PEERS[peerId];
    if (!peer) throw new Error(`Unknown peer ${peerId}`);
    return {
      id: peerId,
      title: peer.displayName,
      username: peer.username,
      kind: "direct",
      avatarDataUrl: null,
      bio: peer.bio,
      phone: peer.phone,
    };
  }

  // The demo "server" search runs over the deterministic fixtures: chats
  // match on title/preview (the old sidebar filter semantics), messages on
  // body text, most recent first — the same sections the teleproto adapter
  // reports from messages.searchGlobal.
  async searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    const term = query.toLocaleLowerCase();
    const chats = [...this.chats.values()].filter((chat) =>
      `${chat.title} ${chat.preview}`.toLocaleLowerCase().includes(term),
    );
    const messages = [...this.messages.entries()]
      .flatMap(([chatId]) => this.visibleMessages(chatId))
      .filter((message) => message.body.toLocaleLowerCase().includes(term))
      .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
    return { chats, messages };
  }

  async searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    this.requireChat(chatId);
    const term = query.toLocaleLowerCase();
    // Telegram's search order is newest first; pagination walks older matches
    // from an exclusive cursor, mirroring messages.Search offsetId semantics.
    const matches = this.visibleMessages(chatId)
      .filter((message) => message.body.toLocaleLowerCase().includes(term))
      .map((message) => message.id)
      .reverse();
    let start = 0;
    if (input.beforeMessageId) {
      const cursorIndex = matches.indexOf(input.beforeMessageId);
      if (cursorIndex === -1) {
        throw new Error(`Unknown message cursor ${input.beforeMessageId}`);
      }
      start = cursorIndex + 1;
    }
    const limit = input.limit ?? matches.length;
    const page = matches.slice(start, start + limit);
    return {
      messageIds: page,
      totalCount: matches.length,
      nextCursor:
        start + page.length < matches.length ? (page.at(-1) ?? null) : null,
    };
  }

  async sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    silent?: boolean,
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto> {
    this.requireChat(chatId);
    if (
      body.includes(DEMO_SEND_FAIL_ONCE_MARKER) &&
      !this.transientFailures.has(body)
    ) {
      this.transientFailures.add(body);
      throw new Error("Demo transient send failure");
    }
    const message: MessageDto = {
      id: crypto.randomUUID(),
      chatId,
      senderName: "You",
      senderId: DEMO_ACCOUNT_PEER_ID,
      senderAvatarUrl: null,
      body,
      entities: entities ?? [],
      media: null,
      groupedId: null,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
      replyTo: replyToId ? this.replySnapshot(chatId, replyToId) : null,
      clientId: clientId ?? null,
    };
    const current = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, [...current, message]);
    this.updateChat(chatId, (chat) => ({
      ...chat,
      preview: message.body,
      updatedAt: message.sentAt,
      draftPreview: null,
    }));
    this.emit({ type: "message-upsert", cause: "new", message });
    // A silent send notifies nobody, so the demo counterpart stays quiet too
    // (no typing indicator, no auto-reply) — which makes the flag observable
    // in E2E.
    if (!silent) this.scheduleAutoReply(chatId);
    return message;
  }

  async downloadMedia(mediaId: string): Promise<void> {
    const active = this.activeDownloads.get(mediaId);
    if (active) return active;
    const task = this.performMediaDownload(mediaId).finally(() => {
      this.activeDownloads.delete(mediaId);
    });
    this.activeDownloads.set(mediaId, task);
    return task;
  }

  async resolveMediaFile(mediaId: string): Promise<string> {
    const media = this.findMedia(mediaId);
    await this.downloadMedia(mediaId);
    return path.join(
      this.requireMediaCacheDirectory(),
      demoCacheFileName(mediaId, media),
    );
  }

  private async performMediaDownload(mediaId: string): Promise<void> {
    const media = this.findMedia(mediaId);
    const directory = this.requireMediaCacheDirectory();
    const fileName = demoCacheFileName(mediaId, media);
    const outputFile = path.join(directory, fileName);
    await mkdir(directory, { recursive: true });
    try {
      const existing = await stat(outputFile);
      await touchMediaCacheFile(outputFile);
      this.publishMediaReady(mediaId, fileName, existing.size);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.emit({
      type: "media-download",
      mediaId,
      state: "downloading",
      downloadedBytes: 0,
      totalBytes: media.kind === "webpage" ? null : media.size,
      url: null,
      error: null,
    });
    // Sent media re-copies the original upload so its bytes stay truthful;
    // received demo media is synthesized deterministically.
    const source = this.sentMediaSources.get(mediaId);
    let size: number;
    if (source) {
      await copyFile(source, outputFile);
      size = (await stat(outputFile)).size;
    } else {
      const bytes = demoMediaBytes(media, mediaId);
      await writeFile(outputFile, bytes);
      size = bytes.length;
    }
    this.publishMediaReady(mediaId, fileName, size);
    await enforceMediaCacheLimit(directory, await this.mediaCacheLimitBytes());
  }

  private requireMediaCacheDirectory(): string {
    if (!this.mediaCacheDirectory) {
      throw new Error("Demo media cache is unavailable");
    }
    return this.mediaCacheDirectory;
  }

  private findMedia(mediaId: string): MessageMediaDto {
    // A set sticker has no carrying message, so it resolves straight from the
    // installed-set fixture; from here on it downloads like any other media.
    const sticker = DEMO_STICKERS.find((entry) => entry.item.id === mediaId);
    if (sticker) return sticker.media;
    for (const messages of this.messages.values()) {
      for (const message of messages) {
        const media = message.media;
        if (!media) continue;
        if (media.id === mediaId) return media;
        if (media.kind === "webpage" && media.thumbnailMediaId === mediaId) {
          return media;
        }
      }
    }
    throw new Error(`Unknown demo media ${mediaId}`);
  }

  private publishMediaReady(
    mediaId: string,
    fileName: string,
    size: number,
  ): void {
    this.emit({
      type: "media-download",
      mediaId,
      state: "ready",
      downloadedBytes: size,
      totalBytes: size,
      url: `telo-media://cache/${encodeURIComponent(fileName)}`,
      error: null,
    });
  }

  async cancelMediaDownload(mediaId: string): Promise<void> {
    // Demo downloads resolve in a single microtask chain, so there is no
    // in-flight work to abort.
    void mediaId;
  }

  async sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    this.requireChat(chatId);
    if (this.activeUploads.has(uploadId)) {
      throw new Error("Upload is already active");
    }
    const upload = { cancelled: false };
    this.activeUploads.set(uploadId, upload);
    this.emit({
      type: "media-upload",
      uploadId,
      state: "uploading",
      progress: 0,
      error: null,
    });
    try {
      for (const step of DEMO_UPLOAD_PROGRESS_STEPS) {
        await this.wait(this.uploadStepMs);
        if (upload.cancelled) {
          this.emit({
            type: "media-upload",
            uploadId,
            state: "cancelled",
            progress: 0,
            error: null,
          });
          throw new Error("Media upload was cancelled");
        }
        this.emit({
          type: "media-upload",
          uploadId,
          state: "uploading",
          progress: step,
          error: null,
        });
      }
      const groupedId = files.length > 1 ? crypto.randomUUID() : null;
      const sentAt = new Date().toISOString();
      const messages = files.map<MessageDto>((file, index) => ({
        id: crypto.randomUUID(),
        chatId,
        senderName: "You",
        senderId: DEMO_ACCOUNT_PEER_ID,
        senderAvatarUrl: null,
        body: index === 0 ? caption : "",
        entities: [],
        media: {
          id: `${chatId}/${crypto.randomUUID()}`,
          kind: file.mimeType.startsWith("image/")
            ? "photo"
            : file.mimeType.startsWith("video/")
              ? "video"
              : "file",
          fileName: file.name,
          mimeType: file.mimeType || null,
          size: file.size,
          width: null,
          height: null,
          duration: null,
          spoiler: false,
        },
        groupedId,
        sentAt,
        outgoing: true,
        status: "sent",
        replyTo:
          index === 0 && replyToId
            ? this.replySnapshot(chatId, replyToId)
            : null,
        clientId: index === 0 ? (clientId ?? null) : null,
      }));
      this.messages.set(chatId, [
        ...(this.messages.get(chatId) ?? []),
        ...messages,
      ]);
      // Sent media stays downloadable with its true bytes: the upload source
      // is copied into the cache and remembered for re-copies after eviction.
      const cacheDirectory = this.mediaCacheDirectory;
      if (cacheDirectory) {
        await mkdir(cacheDirectory, { recursive: true });
        await Promise.all(
          messages.map(async (message, index) => {
            const media = message.media;
            if (!media || media.kind === "webpage") return;
            this.sentMediaSources.set(media.id, files[index].source);
            await copyFile(
              files[index].source,
              path.join(cacheDirectory, demoCacheFileName(media.id, media)),
            );
          }),
        );
      }
      this.updateChat(chatId, (chat) => ({
        ...chat,
        preview: caption || files[0].name,
        updatedAt: sentAt,
        draftPreview: null,
      }));
      for (const message of messages) {
        this.emit({ type: "message-upsert", cause: "new", message });
      }
      this.emit({
        type: "media-upload",
        uploadId,
        state: "ready",
        progress: 1,
        error: null,
      });
      return messages;
    } finally {
      this.activeUploads.delete(uploadId);
    }
  }

  async cancelMediaUpload(uploadId: string): Promise<void> {
    const upload = this.activeUploads.get(uploadId);
    if (upload) upload.cancelled = true;
  }

  // The picker lists installed sets only, so the set drops out of it once the
  // sheet removes it and returns once it is added back.
  async listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    const set: StickerSetDto = {
      ...DEMO_STICKER_SET,
      installed: this.stickerSetInstalled,
    };
    return set.installed ? [set] : [];
  }

  // The sheet a received sticker opens reads its set by short name, whether or
  // not the account has it installed.
  async getStickerSet(shortName: string): Promise<StickerSetDto> {
    this.requireStickerSet(shortName);
    return { ...DEMO_STICKER_SET, installed: this.stickerSetInstalled };
  }

  async setStickerSetInstalled(
    shortName: string,
    installed: boolean,
  ): Promise<void> {
    this.requireStickerSet(shortName);
    this.stickerSetInstalled = installed;
  }

  // A custom-emoji entity names a bare document id. The demo's stickers are
  // those documents, so the fixture answers both.
  async getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    return documentIds.flatMap((documentId) => {
      const sticker = DEMO_STICKERS.find(
        (entry) => entry.item.id === `sticker/${documentId}`,
      );
      // An id Telegram no longer serves is simply absent from the answer.
      return sticker ? [sticker.item] : [];
    });
  }

  private requireStickerSet(shortName: string): void {
    if (shortName !== DEMO_STICKER_SET_SHORT_NAME) {
      throw new Error(`Unknown sticker set ${shortName}`);
    }
  }

  // Sending a set sticker is an ordinary outgoing message carrying the
  // sticker's media, so the transcript renders it exactly like a received one.
  async sendSticker(chatId: string, stickerId: string): Promise<MessageDto> {
    this.requireChat(chatId);
    const sticker = DEMO_STICKERS.find((entry) => entry.item.id === stickerId);
    if (!sticker) throw new Error(`Unknown sticker ${stickerId}`);
    const message: MessageDto = {
      id: crypto.randomUUID(),
      chatId,
      senderName: "You",
      senderId: DEMO_ACCOUNT_PEER_ID,
      senderAvatarUrl: null,
      body: "",
      entities: [],
      media: sticker.media,
      groupedId: null,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
    };
    const current = this.messages.get(chatId) ?? [];
    this.messages.set(chatId, [...current, message]);
    // A sticker has no body, so Telegram previews the dialog by its emoji.
    this.updateChat(chatId, (chat) => ({
      ...chat,
      preview: sticker.item.emoji ?? "Sticker",
      updatedAt: message.sentAt,
      draftPreview: null,
    }));
    this.emit({ type: "message-upsert", cause: "new", message });
    return message;
  }

  async setTyping(chatId: string, typing: boolean): Promise<void> {
    // The local user's own typing signal has no counterpart to notify in the
    // demo workspace; teleproto sends it out over the wire in production.
    void typing;
    this.requireChat(chatId);
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
    this.requireChat(chatId);
    const draftPreview = text.trim() ? text : null;
    this.updateChatSilently(chatId, (chat) => ({ ...chat, draftPreview }));
    this.emit({ type: "draft", chatId, draftPreview });
  }

  /**
   * Demo-only realism: after the user sends a message, the recipient "types"
   * and then replies, so Wave 1's typing indicator and message sync have
   * something to show in jsdom/E2E without a live Telegram account.
   */
  private scheduleAutoReply(chatId: string): void {
    const reply = DEMO_AUTO_REPLIES[chatId];
    if (!reply) return; // Saved Messages and unknown chats have no counterpart.
    const typingTimer = setTimeout(() => {
      this.timers.delete(typingTimer);
      this.emit({ type: "typing", chatId, typing: true });
    }, this.typingDelayMs);
    this.timers.add(typingTimer);

    const replyTimer = setTimeout(() => {
      this.timers.delete(replyTimer);
      this.emit({ type: "typing", chatId, typing: false });
      const chat = this.chats.get(chatId);
      if (!chat) return;
      const message: MessageDto = {
        id: crypto.randomUUID(),
        chatId,
        senderName: chat.title,
        senderId: chatId,
        senderAvatarUrl: null,
        body: reply,
        entities: [],
        media: null,
        groupedId: null,
        sentAt: new Date().toISOString(),
        outgoing: false,
        status: "read",
      };
      const current = this.messages.get(chatId) ?? [];
      this.messages.set(chatId, [...current, message]);
      this.updateChat(chatId, (entry) => ({
        ...entry,
        preview: message.body,
        updatedAt: message.sentAt,
      }));
      this.emit({ type: "message-upsert", cause: "new", message });
    }, this.autoReplyDelayMs);
    this.timers.add(replyTimer);
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    const { message, messages } = this.findMessage(
      input.chatId,
      input.messageId,
    );
    // Telegram rule: only one's own messages can be edited.
    if (!message.outgoing)
      throw new Error(`Message ${input.messageId} is not outgoing`);
    const edited: MessageDto = {
      ...message,
      body: input.body,
      entities: [],
      editedAt: new Date().toISOString(),
    };
    this.messages.set(
      input.chatId,
      messages.map((entry) => (entry.id === edited.id ? edited : entry)),
    );
    this.emit({ type: "message-upsert", cause: "edited", message: edited });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    const { messages } = this.findMessage(input.chatId, input.messageId);
    if (input.scope === "me") {
      // Delete-for-me keeps the message for other participants; this client
      // just stops seeing it.
      this.hiddenMessageIds.add(`${input.chatId}:${input.messageId}`);
    } else {
      this.messages.set(
        input.chatId,
        messages.filter((entry) => entry.id !== input.messageId),
      );
    }
    this.emit({
      type: "message-delete",
      chatId: input.chatId,
      messageIds: [input.messageId],
    });
  }

  async forwardMessage(input: ForwardMessageInput): Promise<void> {
    const { message: source } = this.findMessage(
      input.fromChatId,
      input.messageId,
    );
    this.requireChat(input.toChatId);
    const forwarded: MessageDto = {
      id: crypto.randomUUID(),
      chatId: input.toChatId,
      senderName: "You",
      senderId: DEMO_ACCOUNT_PEER_ID,
      senderAvatarUrl: null,
      body: source.body,
      entities: source.entities,
      media: source.media,
      groupedId: null,
      sentAt: new Date().toISOString(),
      outgoing: true,
      status: "sent",
      // A forwarded copy is not a reply; it never carries the source replyTo.
      replyTo: null,
      // Telegram keeps the original author on chained forwards, header and
      // all — a copy is never re-attributed to whoever forwarded it. "Hide
      // sender" drops the attribution entirely, like dropAuthor on the wire.
      // A first forward mirrors the header's `savedFromPeer` case, which is
      // literally what forwarding into Saved Messages produces on the wire:
      // the copy points back at the chat and the message it was made from,
      // so following the attribution lands on a peer and a message the demo
      // workspace actually holds.
      forwardedFrom: input.hideSender
        ? null
        : (source.forwardedFrom ?? {
            senderName: source.senderName,
            senderId: input.fromChatId,
            messageId: input.messageId,
            postAuthor: null,
          }),
    };
    const current = this.messages.get(input.toChatId) ?? [];
    this.messages.set(input.toChatId, [...current, forwarded]);
    // Your own outgoing message refreshes the dialog preview without
    // touching the unread counter.
    this.updateChat(input.toChatId, (chat) => ({
      ...chat,
      preview: forwarded.body,
      updatedAt: forwarded.sentAt,
    }));
    this.emit({ type: "message-upsert", cause: "new", message: forwarded });
  }

  async answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    // findMessage rejects an unknown chat or message; what remains to check
    // is that the button exists and is a callback one.
    const { message } = this.findMessage(chatId, messageId);
    const answer = DEMO_BOT_CALLBACK_ANSWERS[message.id]?.[buttonId];
    if (!answer) {
      throw new Error(
        `Unknown callback button ${buttonId} of message ${messageId}`,
      );
    }
    return answer;
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    this.updateChat(chatId, (chat) => ({ ...chat, pinned }));
  }

  async setChatMuted(chatId: string, muted: boolean): Promise<void> {
    this.updateChat(chatId, (chat) => ({ ...chat, muted }));
  }

  async setChatRead(chatId: string, read: boolean): Promise<void> {
    // Telegram dialog rule: read clears the counter, unread flags the dialog.
    this.updateChat(chatId, (chat) => ({ ...chat, unreadCount: read ? 0 : 1 }));
    // Folder badges derive from the member chats' unread counts, so a read
    // state change moves them; emit the fresh snapshot.
    this.emit({ type: "folders", folders: this.foldersSnapshot() });
  }

  // Demo logout is a harmless no-op: resetting the demo workspace is owned by
  // the renderer clearing the demoWorkspace preference.
  async logout(): Promise<void> {}

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  private replySnapshot(chatId: string, messageId: string): MessageReplyToDto {
    const { message } = this.findMessage(chatId, messageId);
    return {
      id: message.id,
      senderName: message.senderName,
      body: message.body,
      entities: message.entities,
    };
  }

  private findMessage(
    chatId: string,
    messageId: string,
  ): { message: MessageDto; messages: ReadonlyArray<MessageDto> } {
    this.requireChat(chatId);
    const messages = this.messages.get(chatId) ?? [];
    const message = messages.find((entry) => entry.id === messageId);
    if (!message) throw new Error(`Unknown message ${messageId}`);
    return { message, messages };
  }

  // The chat's messages as this client sees them: delete-for-me entries are
  // hidden here but stay in the store for the other participants.
  private visibleMessages(chatId: string): ReadonlyArray<MessageDto> {
    return (this.messages.get(chatId) ?? []).filter(
      (entry) => !this.hiddenMessageIds.has(`${chatId}:${entry.id}`),
    );
  }

  private requireChat(chatId: string): void {
    if (!this.chats.has(chatId)) throw new Error(`Unknown chat ${chatId}`);
  }

  private updateChat(chatId: string, update: (chat: ChatDto) => ChatDto): void {
    this.updateChatSilently(chatId, update);
    const chat = this.chats.get(chatId);
    if (chat) this.emit({ type: "chat-upsert", chat });
  }

  // Draft updates emit a dedicated "draft" event instead of "chat-upsert" so
  // the renderer can distinguish "someone is drafting" from a full chat
  // refresh; this still keeps the in-memory snapshot consistent.
  private updateChatSilently(
    chatId: string,
    update: (chat: ChatDto) => ChatDto,
  ): void {
    const chat = this.chats.get(chatId);
    if (!chat) throw new Error(`Unknown chat ${chatId}`);
    this.chats.set(chatId, update(chat));
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

// Cache names derive from the media id plus the original extension, so the
// same media always resolves to the same file — downloads, re-copies after
// eviction, and `resolveMediaFile` all agree without extra bookkeeping.
function demoCacheFileName(mediaId: string, media: MessageMediaDto): string {
  const stem = mediaId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const originalName = media.kind === "webpage" ? null : media.fileName;
  const extension = originalName
    ? path
        .extname(originalName)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, "")
        .slice(0, 12)
    : "";
  const fallback =
    media.kind === "video" || media.kind === "video-note" ? ".webm" : ".png";
  return `${stem}${extension || fallback}`;
}

// The demo workspace synthesizes what a real client downloads from Telegram's
// CDN. A sticker follows its declared format so the renderer exercises the
// Lottie and video paths, not only the still one.
function demoMediaBytes(media: MessageMediaDto, mediaId: string): Buffer {
  // A link preview downloads its thumbnail, which is an image like any other.
  if (media.kind === "webpage") return demoImagePng(mediaId);
  if (media.kind === "sticker") {
    if (media.sticker?.format === "animated") return demoStickerTgs();
    if (media.sticker?.format === "video") return demoVideoWebm();
    return demoImagePng(mediaId);
  }
  if (media.kind === "video" || media.kind === "video-note") {
    return demoVideoWebm();
  }
  return demoImagePng(mediaId);
}
