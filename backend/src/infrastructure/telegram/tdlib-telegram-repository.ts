import path from "node:path";

import type * as Td from "tdlib-types";

import type {
  AvatarPlaceholderDto,
  AnimatedEmojiEffectDto,
  BotCallbackAnswerDto,
  ChatDto,
  ChatFolderDto,
  ChatMemberDto,
  ChatPageDto,
  ChatPageInput,
  CreateTelegramChannelInput,
  CreateTelegramGroupInput,
  CurrentUserDto,
  DeleteMessageInput,
  EditMessageInput,
  ForwardMessageInput,
  GlobalSearchResultDto,
  MessageDto,
  MessageEntityDto,
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  PostedStoryDto,
  PostStoryInput,
  SetMessageReactionInput,
  StickerCatalogDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
  TelegramCallDto,
  TelegramCallPageDto,
  TelegramContactDto,
  TelegramWorkspaceEvent,
} from "../../../../contracts/src/ipc";
import type {
  TelegramAccountDatabase,
  TelegramConnectionProfileRepository,
  TelegramRepository,
  TelegramUploadFile,
} from "../../domain/telegram/telegram-ports";
import { DemoTelegramRepository } from "./demo-telegram-repository";
import {
  configureTdlib,
  createTdlibBridge,
  type TdlibBridge,
} from "./tdlib-client";
import type { TdjsonResolveOptions } from "./tdlib-json-path";
import {
  accentPaletteOf,
  chatIdOf,
  compareListOrder,
  fileIdFromMediaId,
  initials,
  mapAuthorizationStatus,
  mapAvailableReactionEmojis,
  mapAvatarPlaceholder,
  mapChat,
  mapConnectionState,
  mapFolders,
  mapMessage,
  mapReactions,
  mapReactionTypeEmojis,
  mediaIdForFile,
  messageIdOf,
  minithumbnailDataUrl,
  normalizeReactionEmoji,
  stickerMedia,
  type MessageMapContext,
} from "./tdlib-mappers";
import { copyIntoMediaCache } from "./file-telegram-account-database";
import {
  avatarCacheFileName,
  avatarMediaUrl,
  enforceMediaCacheLimit,
  isSharpAvatarCacheUrl,
  listCachedAvatarUrls,
} from "./media-cache";
import type { TelegramAccountClient } from "./telegram-account-coordinator";

/** Telegram Desktop drops a typing indicator after about six seconds. */
const TYPING_EXPIRY_MS = 6_000;

export class TdlibTelegramRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly chats = new Map<string, Td.chat>();
  private readonly users = new Map<number, Td.user>();
  private readonly basicGroups = new Map<number, Td.basicGroup>();
  private readonly supergroups = new Map<number, Td.supergroup>();
  private readonly folders: Td.chatFolderInfo[] = [];
  private readonly clientIds = new Map<string, string>();
  private readonly stickersByFileId = new Map<number, Td.sticker>();
  private readonly callbackData = new Map<string, string>();
  private readonly filePaths = new Map<string, string>();
  private readonly avatarUrls = new Map<string, string | null>();
  private readonly avatarFilePeers = new Map<number, string>();
  private readonly customAccentColors = new Map<number, Td.accentColor>();
  /** User ids that have been fetched with `getUser`, not a min `updateUser`. */
  private readonly fetchedUserIds = new Set<number>();
  private readonly typingTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly secretChats = new Map<number, Td.secretChat>();
  private readonly stickerOutlines = new Map<number, string | null>();
  /** Account-wide default emoji set from `updateActiveEmojiReactions`. */
  private activeEmojiReactions: ReadonlyArray<string> = [];
  private selfUserId: number | null = null;
  private sendingId = 1;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly client: TdlibBridge,
    private readonly mediaCacheDirectory: string,
    private readonly mediaCacheLimitBytes: () => Promise<number>,
  ) {
    this.unsubscribe = client.onUpdate((update) => {
      void this.handleUpdate(update);
    });
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async hydrate(): Promise<void> {
    await this.hydrateAvatarsFromDisk();
    const me = await this.resolveFullUser(
      await this.client.invoke<Td.user>({ _: "getMe" }),
    );
    this.selfUserId = me.id;
    await this.scheduleUserAvatar(me, true);
    await this.loadList({ _: "chatListMain" });
    await this.loadList({ _: "chatListArchive" });
    this.emit({
      type: "chats",
      chats: this.orderedChats(),
      nextCursor: null,
    });
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    const me = await this.resolveFullUser(
      await this.client.invoke<Td.user>({ _: "getMe" }),
    );
    this.selfUserId = me.id;
    await this.scheduleUserAvatar(me, true);
    const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
    const id = String(me.id);
    return {
      id,
      displayName: name,
      username: me.usernames?.active_usernames[0] ?? null,
      initials: initials(name || "You"),
      avatarDataUrl: this.avatarUrls.get(id) ?? null,
      avatarPending: this.avatarIsPending(id),
      avatarPlaceholder: mapAvatarPlaceholder(
        name || "You",
        me.accent_color_id ?? 0,
        (colorId) => accentPaletteOf(colorId, this.customAccentColors),
      ),
    };
  }

  async listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    const chats = this.orderedChats();
    const start = input.cursor
      ? chats.findIndex((chat) => chat.id === input.cursor) + 1
      : 0;
    const limit = input.limit ?? 50;
    const items = chats.slice(start, start + limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: start + items.length < chats.length && last ? last.id : null,
    };
  }

  async createSecretChat(userId: string): Promise<ChatDto> {
    const chat = await this.client.invoke<Td.chat>({
      _: "createNewSecretChat",
      user_id: Number(userId),
    });
    return this.acceptCreatedChat(chat);
  }

  async listContacts(): Promise<ReadonlyArray<TelegramContactDto>> {
    const result = await this.client.invoke<Td.users>({ _: "getContacts" });
    await Promise.all(
      result.user_ids.map(async (userId) => {
        if (!this.users.has(userId)) await this.fetchUser(userId);
      }),
    );
    return result.user_ids.flatMap((userId) => {
      const user = this.users.get(userId);
      if (!user || user.type._ === "userTypeDeleted") return [];
      void this.scheduleUserAvatar(user);
      const peerId = String(user.id);
      const displayName = [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ");
      return [
        {
          id: peerId,
          displayName: displayName || peerId,
          username: user.usernames?.active_usernames[0] ?? null,
          phone: user.phone_number || null,
          avatarDataUrl: this.avatarUrls.get(peerId) ?? null,
          avatarPending: this.avatarIsPending(peerId),
          avatarPlaceholder: this.avatarPlaceholderForPeer(peerId),
        },
      ];
    });
  }

  async openPrivateChat(userId: string): Promise<ChatDto> {
    const chat = await this.client.invoke<Td.chat>({
      _: "createPrivateChat",
      user_id: Number(userId),
      force: false,
    });
    return this.acceptCreatedChat(chat);
  }

  async createGroup(input: CreateTelegramGroupInput): Promise<ChatDto> {
    const created = await this.client.invoke<Td.createdBasicGroupChat>({
      _: "createNewBasicGroupChat",
      user_ids: input.userIds.map(Number),
      title: input.title,
      message_auto_delete_time: 0,
    });
    const chat = await this.client.invoke<Td.chat>({
      _: "getChat",
      chat_id: created.chat_id,
    });
    return this.acceptCreatedChat(chat);
  }

  async createChannel(input: CreateTelegramChannelInput): Promise<ChatDto> {
    const chat = await this.client.invoke<Td.chat>({
      _: "createNewSupergroupChat",
      title: input.title,
      is_forum: false,
      is_channel: true,
      description: input.description ?? "",
      message_auto_delete_time: 0,
      for_import: false,
    });
    return this.acceptCreatedChat(chat);
  }

  async listCalls(cursor: string | null = null): Promise<TelegramCallPageDto> {
    const result = await this.client.invoke<Td.foundMessages>({
      _: "searchCallMessages",
      offset: cursor ?? "",
      limit: 50,
      only_missed: false,
    });
    const items: TelegramCallDto[] = [];
    for (const message of result.messages) {
      const content = message.content;
      if (content._ !== "messageCall" && content._ !== "messageGroupCall") {
        continue;
      }
      const chatId = chatIdOf(message.chat_id);
      let chat = this.chats.get(chatId);
      if (!chat) {
        chat = await this.client.invoke<Td.chat>({
          _: "getChat",
          chat_id: message.chat_id,
        });
        this.chats.set(chatId, chat);
        this.scheduleChatAvatar(chat);
      }
      const missed =
        content._ === "messageCall"
          ? !message.is_outgoing &&
            (content.discard_reason._ === "callDiscardReasonMissed" ||
              content.discard_reason._ === "callDiscardReasonDeclined")
          : content.was_missed;
      const chatDto = this.toChat(chat);
      items.push({
        id: messageIdOf(message.id),
        chatId,
        title: chat.title,
        avatarDataUrl: chatDto.avatarDataUrl,
        avatarPlaceholder: chatDto.avatarPlaceholder,
        kind: missed ? "missed" : message.is_outgoing ? "outgoing" : "incoming",
        video: content.is_video,
        occurredAt: new Date(message.date * 1000).toISOString(),
        durationSeconds: content.duration,
      });
    }
    return { items, nextCursor: result.next_offset || null };
  }

  async postStory(
    file: TelegramUploadFile,
    input: PostStoryInput,
  ): Promise<PostedStoryDto> {
    const saved = await this.openSavedMessages();
    const video = file.mimeType.startsWith("video/");
    const content: Td.InputStoryContent$Input = video
      ? {
          _: "inputStoryContentVideo",
          video: { _: "inputFileLocal", path: file.source },
          duration: input.durationSeconds ?? 0,
          cover_frame_timestamp: 0,
          is_animation: false,
        }
      : {
          _: "inputStoryContentPhoto",
          photo: { _: "inputFileLocal", path: file.source },
        };
    const privacy: Td.StoryPrivacySettings$Input =
      input.privacy === "everyone"
        ? { _: "storyPrivacySettingsEveryone", except_user_ids: [] }
        : input.privacy === "contacts"
          ? { _: "storyPrivacySettingsContacts", except_user_ids: [] }
          : { _: "storyPrivacySettingsCloseFriends" };
    const story = await this.client.invoke<Td.story>({
      _: "postStory",
      chat_id: Number(saved.id),
      content,
      caption: {
        _: "formattedText",
        text: input.caption ?? "",
        entities: [],
      },
      privacy_settings: privacy,
      album_ids: [],
      active_period: input.activePeriod,
      is_posted_to_chat_page: true,
      protect_content: input.protectContent ?? false,
    });
    return {
      id: String(story.id),
      posterChatId: String(story.poster_chat_id),
      postedAt: new Date(story.date * 1000).toISOString(),
      expiresAt: new Date(
        (story.date + input.activePeriod) * 1000,
      ).toISOString(),
      video: story.content._ === "storyContentVideo",
    };
  }

  async openSavedMessages(): Promise<ChatDto> {
    const me = await this.client.invoke<Td.user>({ _: "getMe" });
    this.selfUserId = me.id;
    this.rememberUser(me);
    const chat = await this.client.invoke<Td.chat>({
      _: "createPrivateChat",
      user_id: me.id,
      force: false,
    });
    this.chats.set(chatIdOf(chat.id), chat);
    this.scheduleChatAvatar(chat);
    const dto = this.toChat(chat);
    this.emit({ type: "chat-upsert", chat: dto });
    return dto;
  }

  async listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return this.folderDtos();
  }

  async listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const limit = input.limit ?? 50;
    const chatIdNum = Number(chatId);
    let fromId = input.beforeMessageId ? Number(input.beforeMessageId) : 0;
    const collected: Td.message[] = [];
    const seen = new Set<number>();
    // TDLib may return fewer than `limit` from local SQLite even when older
    // messages exist. Loop a few batches so the first paint is not a single
    // "Today" bubble with a dead cursor.
    const maxBatches = 5;
    for (
      let batch = 0;
      batch < maxBatches && collected.length < limit;
      batch += 1
    ) {
      const history = await this.client.invoke<Td.messages>({
        _: "getChatHistory",
        chat_id: chatIdNum,
        from_message_id: fromId,
        offset: 0,
        limit,
        only_local: false,
      });
      const batchMessages = (history.messages ?? []).filter(
        (message): message is Td.message => message !== null,
      );
      if (batchMessages.length === 0) break;
      let added = 0;
      for (const message of batchMessages) {
        // offset 0 includes the cursor message; drop it so pages do not overlap.
        if (fromId !== 0 && message.id === fromId) continue;
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        collected.push(message);
        added += 1;
        if (collected.length >= limit) break;
      }
      const oldest = batchMessages.at(-1);
      if (!oldest || oldest.id === fromId || added === 0) break;
      fromId = oldest.id;
    }
    const items = await Promise.all(
      [...collected].reverse().map((message) => this.toMessage(message)),
    );
    const oldest = collected.at(-1);
    return {
      items,
      // A short page is not the end of history. The next call may come back
      // empty, which clears the cursor; a one-message chat pays that extra round.
      nextCursor: oldest ? messageIdOf(oldest.id) : null,
    };
  }

  async listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const limit = input.limit ?? 50;
    const fromMessageId = input.beforeMessageId
      ? Number(input.beforeMessageId)
      : 0;
    const [visual, files] = await Promise.all([
      this.client.invoke<Td.foundChatMessages>({
        _: "searchChatMessages",
        chat_id: Number(chatId),
        query: "",
        from_message_id: fromMessageId,
        offset: 0,
        limit,
        filter: { _: "searchMessagesFilterPhotoAndVideo" },
      }),
      this.client.invoke<Td.foundChatMessages>({
        _: "searchChatMessages",
        chat_id: Number(chatId),
        query: "",
        from_message_id: fromMessageId,
        offset: 0,
        limit,
        filter: { _: "searchMessagesFilterDocument" },
      }),
    ]);
    const merged = new Map<number, Td.message>();
    for (const message of [
      ...(visual.messages ?? []),
      ...(files.messages ?? []),
    ]) {
      merged.set(message.id, message);
    }
    const ordered = [...merged.values()].sort(
      (left, right) => left.id - right.id,
    );
    const items = await Promise.all(
      ordered.map((message) => this.toMessage(message)),
    );
    const oldest = ordered[0];
    const more =
      (visual.messages?.length ?? 0) >= limit ||
      (files.messages?.length ?? 0) >= limit;
    return {
      items,
      nextCursor: more && oldest ? messageIdOf(oldest.id) : null,
    };
  }

  async listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    const found = await this.client.invoke<Td.foundChatMessages>({
      _: "searchChatMessages",
      chat_id: Number(chatId),
      query: "",
      from_message_id: 0,
      offset: 0,
      limit: 50,
      filter: { _: "searchMessagesFilterPinned" },
    });
    return Promise.all(
      found.messages.map((message) => this.toMessage(message)),
    );
  }

  async listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    const chat = this.chats.get(chatId);
    if (!chat) return [];
    if (chat.type._ === "chatTypeSupergroup") {
      if (chat.type.is_channel) return [];
      const members = await this.client.invoke<Td.chatMembers>({
        _: "getSupergroupMembers",
        supergroup_id: chat.type.supergroup_id,
        offset: 0,
        limit: 50,
      });
      if (members._ !== "chatMembers") return [];
      return this.toChatMembers(members.members);
    }
    if (chat.type._ === "chatTypeBasicGroup") {
      const full = await this.client.invoke<Td.basicGroupFullInfo>({
        _: "getBasicGroupFullInfo",
        basic_group_id: chat.type.basic_group_id,
      });
      if (full._ !== "basicGroupFullInfo") return [];
      return this.toChatMembers(full.members);
    }
    return [];
  }

  async getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    const user = await this.client
      .invoke<Td.user>({ _: "getUser", user_id: Number(peerId) })
      .catch(() => null);
    if (user) {
      this.rememberUser(user);
      this.scheduleUserAvatar(user);
      const full = await this.client
        .invoke<Td.userFullInfo>({ _: "getUserFullInfo", user_id: user.id })
        .catch(() => null);
      const id = String(user.id);
      return {
        id,
        title: [user.first_name, user.last_name].filter(Boolean).join(" "),
        username: user.usernames?.active_usernames[0] ?? null,
        kind: "direct",
        avatarDataUrl: this.avatarUrls.get(id) ?? null,
        avatarPending: this.avatarIsPending(id),
        avatarPlaceholder: mapAvatarPlaceholder(
          [user.first_name, user.last_name].filter(Boolean).join(" "),
          user.accent_color_id ?? 0,
          (colorId) => accentPaletteOf(colorId, this.customAccentColors),
        ),
        bio: full?.bio?.text ?? null,
        phone: user.phone_number || null,
      };
    }
    const chat = this.chats.get(peerId);
    if (!chat) throw new Error(`Unknown peer ${peerId}`);
    this.scheduleChatAvatar(chat);
    return {
      id: peerId,
      title: chat.title,
      username: null,
      kind: this.toChat(chat).kind,
      avatarDataUrl: this.avatarUrls.get(peerId) ?? null,
      avatarPending: this.avatarIsPending(peerId),
      avatarPlaceholder: this.avatarPlaceholderForPeer(peerId),
      bio: null,
      phone: null,
    };
  }

  async listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    const catalog = await this.getStickerCatalog();
    return Promise.all(
      catalog.sets.map((set) => this.getStickerSet(set.reference)),
    );
  }

  async getStickerCatalog(): Promise<StickerCatalogDto> {
    const installed = await this.client.invoke<Td.stickerSets>({
      _: "getInstalledStickerSets",
      sticker_type: { _: "stickerTypeRegular" },
    });
    const recent = await this.client
      .invoke<Td.stickers>({ _: "getRecentStickers", is_attached: false })
      .catch(() => ({ stickers: [] as Td.sticker[] }));
    const favorites = await this.client
      .invoke<Td.stickers>({ _: "getFavoriteStickers" })
      .catch(() => ({ stickers: [] as Td.sticker[] }));
    return {
      recent: await Promise.all(
        recent.stickers.map((item) => this.toStickerItem(item)),
      ),
      favorites: await Promise.all(
        favorites.stickers.map((item) => this.toStickerItem(item)),
      ),
      sets: installed.sets.map((set) => ({
        id: set.id,
        title: set.title,
        shortName: set.name,
        reference: { kind: "id" as const, id: set.id },
      })),
    };
  }

  async reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    await this.client.invoke({
      _: "reorderInstalledStickerSets",
      sticker_type: { _: "stickerTypeRegular" },
      sticker_set_ids: setIds,
    });
  }

  async setStickerFavorite(
    stickerId: string,
    favorite: boolean,
  ): Promise<void> {
    const fileId = fileIdFromMediaId(stickerId);
    if (fileId === null) throw new Error("Sticker id is required");
    await this.client.invoke({
      _: favorite ? "addFavoriteSticker" : "removeFavoriteSticker",
      sticker: { _: "inputFileId", id: fileId },
    });
  }

  async removeRecentSticker(stickerId: string): Promise<void> {
    const fileId = fileIdFromMediaId(stickerId);
    if (fileId === null) throw new Error("Sticker id is required");
    await this.client.invoke({
      _: "removeRecentSticker",
      is_attached: false,
      sticker: { _: "inputFileId", id: fileId },
    });
  }

  async clearRecentStickers(): Promise<void> {
    await this.client.invoke({ _: "clearRecentStickers", is_attached: false });
  }

  async searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    const result = await this.client.invoke<Td.stickers>({
      _: "searchStickers",
      sticker_type: { _: "stickerTypeRegular" },
      emojis: query,
      query,
      offset: 0,
      limit: 32,
    });
    return Promise.all(result.stickers.map((item) => this.toStickerItem(item)));
  }

  async sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto> {
    this.assertCanWrite(chatId, "stickers");
    const fileId = fileIdFromMediaId(stickerId);
    if (fileId === null) throw new Error("Sticker id is required");
    const cached = this.stickersByFileId.get(fileId);
    const sendingId = this.nextSendingId();
    this.rememberClientId(sendingId, clientId);
    const send = () =>
      this.client.invoke<Td.message>({
        _: "sendMessage",
        chat_id: Number(chatId),
        options: {
          _: "messageSendOptions",
          sending_id: sendingId,
        },
        input_message_content: {
          _: "inputMessageSticker",
          sticker: {
            _: "inputSticker",
            sticker: { _: "inputFileId", id: fileId },
            width: cached?.width ?? 0,
            height: cached?.height ?? 0,
          },
          emoji: cached?.emoji ?? "",
        },
      });
    let message: Td.message;
    try {
      message = await send();
    } catch (error) {
      if (!isStickerFileNotReady(error)) throw error;
      await this.client.invoke({
        _: "downloadFile",
        file_id: fileId,
        priority: 32,
        offset: 0,
        limit: 0,
        synchronous: true,
      });
      message = await send();
    }
    this.bindPendingClientId(message);
    const dto = await this.toMessage(message);
    return clientId ? { ...dto, clientId } : dto;
  }

  async getStickerSet(
    reference: StickerSetReferenceDto,
  ): Promise<StickerSetDto> {
    const set =
      reference.kind === "short-name"
        ? await this.client.invoke<Td.stickerSet>({
            _: "searchStickerSet",
            name: reference.shortName,
          })
        : await this.client.invoke<Td.stickerSet>({
            _: "getStickerSet",
            set_id: reference.id,
          });
    return {
      id: set.id,
      title: set.title,
      shortName: set.name,
      reference: { kind: "id", id: set.id },
      stickers: await Promise.all(
        set.stickers.map((item) => this.toStickerItem(item)),
      ),
      installed: set.is_installed,
    };
  }

  async setStickerSetInstalled(
    shortName: string,
    installed: boolean,
  ): Promise<void> {
    const set = await this.client.invoke<Td.stickerSet>({
      _: "searchStickerSet",
      name: shortName,
    });
    await this.client.invoke({
      _: "changeStickerSet",
      set_id: set.id,
      is_installed: installed,
      is_archived: false,
    });
  }

  async getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    if (documentIds.length === 0) return [];
    const stickers = await this.client.invoke<Td.stickers>({
      _: "getCustomEmojiStickers",
      custom_emoji_ids: documentIds,
    });
    return Promise.all(
      stickers.stickers.map((item) => this.toStickerItem(item)),
    );
  }

  async searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    const chatsFound = await this.client.invoke<Td.chats>({
      _: "searchChats",
      query,
      limit: 20,
    });
    const messagesFound = await this.client.invoke<Td.foundMessages>({
      _: "searchMessages",
      chat_list: { _: "chatListMain" },
      query,
      offset: "",
      limit: 20,
      filter: { _: "searchMessagesFilterEmpty" },
    });
    const chats = chatsFound.chat_ids
      .map((id) => this.chats.get(chatIdOf(id)))
      .filter((chat): chat is Td.chat => Boolean(chat))
      .map((chat) => this.toChat(chat));
    const messages = await Promise.all(
      messagesFound.messages.map((message) => this.toMessage(message)),
    );
    return { chats, messages };
  }

  async searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    const found = await this.client.invoke<Td.foundChatMessages>({
      _: "searchChatMessages",
      chat_id: Number(chatId),
      query,
      from_message_id: input.beforeMessageId
        ? Number(input.beforeMessageId)
        : 0,
      offset: 0,
      limit: input.limit ?? 20,
    });
    return {
      messageIds: found.messages.map((message) => messageIdOf(message.id)),
      totalCount: found.total_count,
      nextCursor: found.next_from_message_id
        ? messageIdOf(found.next_from_message_id)
        : null,
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
    this.assertCanWrite(chatId);
    const sendingId = this.nextSendingId();
    this.rememberClientId(sendingId, clientId);
    const message = await this.client.invoke<Td.message>({
      _: "sendMessage",
      chat_id: Number(chatId),
      reply_to: replyToId
        ? {
            _: "inputMessageReplyToMessage",
            message_id: Number(replyToId),
          }
        : undefined,
      options: {
        _: "messageSendOptions",
        disable_notification: Boolean(silent),
        sending_id: sendingId,
      },
      input_message_content: {
        _: "inputMessageText",
        text: {
          _: "formattedText",
          text: body,
          entities: (entities ?? []).map(toTdEntity),
        },
      },
    });
    this.bindPendingClientId(message);
    const dto = await this.toMessage(message);
    return clientId ? { ...dto, clientId } : dto;
  }

  async downloadMedia(mediaId: string): Promise<void> {
    const fileId = fileIdFromMediaId(mediaId);
    if (fileId === null) throw new Error("Media id is required");
    this.emit({
      type: "media-download",
      mediaId,
      state: "downloading",
      downloadedBytes: 0,
      totalBytes: 0,
      url: null,
      error: null,
    });
    await this.client.invoke({
      _: "downloadFile",
      file_id: fileId,
      priority: 32,
      offset: 0,
      limit: 0,
      synchronous: true,
    });
  }

  async cancelMediaDownload(mediaId: string): Promise<void> {
    const fileId = fileIdFromMediaId(mediaId);
    if (fileId === null) return;
    await this.client.invoke({
      _: "cancelDownloadFile",
      file_id: fileId,
      only_if_pending: false,
    });
    this.emit({
      type: "media-download",
      mediaId,
      state: "cancelled",
      downloadedBytes: 0,
      totalBytes: 0,
      url: null,
      error: null,
    });
  }

  async resolveMediaFile(mediaId: string): Promise<string> {
    const cached = this.filePaths.get(mediaId);
    if (cached) return cached;
    await this.downloadMedia(mediaId);
    const cachedAfter = this.filePaths.get(mediaId);
    if (!cachedAfter) throw new Error(`Media ${mediaId} is not on disk`);
    return cachedAfter;
  }

  async sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    this.assertCanWrite(chatId, "media");
    this.emit({
      type: "media-upload",
      uploadId,
      state: "uploading",
      progress: 0,
      error: null,
    });
    const contents = files.map((file, index) =>
      inputContentForFile(
        file,
        index === 0 && caption
          ? { _: "formattedText" as const, text: caption, entities: [] }
          : undefined,
      ),
    );
    const replyTo = replyToId
      ? {
          _: "inputMessageReplyToMessage" as const,
          message_id: Number(replyToId),
        }
      : undefined;
    const sendingId = this.nextSendingId();
    this.rememberClientId(sendingId, clientId);
    const sendOptions = {
      _: "messageSendOptions" as const,
      sending_id: sendingId,
    };
    const sent =
      contents.length === 1
        ? [
            await this.client.invoke<Td.message>({
              _: "sendMessage",
              chat_id: Number(chatId),
              reply_to: replyTo,
              options: sendOptions,
              input_message_content: contents[0],
            }),
          ]
        : (
            await this.client.invoke<Td.messages>({
              _: "sendMessageAlbum",
              chat_id: Number(chatId),
              reply_to: replyTo,
              options: sendOptions,
              input_message_contents: contents,
            })
          ).messages;
    this.emit({
      type: "media-upload",
      uploadId,
      state: "ready",
      progress: 1,
      error: null,
    });
    const mapped = await Promise.all(
      sent
        .filter((message): message is Td.message => message !== null)
        .map((message) => {
          this.bindPendingClientId(message);
          return this.toMessage(message);
        }),
    );
    return clientId
      ? mapped.map((message) => ({ ...message, clientId }))
      : mapped;
  }

  async cancelMediaUpload(uploadId: string): Promise<void> {
    this.emit({
      type: "media-upload",
      uploadId,
      state: "cancelled",
      progress: 0,
      error: null,
    });
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    this.assertCanWrite(input.chatId);
    await this.client.invoke({
      _: "editMessageText",
      chat_id: Number(input.chatId),
      message_id: Number(input.messageId),
      input_message_content: {
        _: "inputMessageText",
        text: {
          _: "formattedText",
          text: input.body,
          entities: [],
        },
      },
    });
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    await this.client.invoke({
      _: "deleteMessages",
      chat_id: Number(input.chatId),
      message_ids: [Number(input.messageId)],
      revoke: input.scope !== "me",
    });
  }

  async forwardMessage(input: ForwardMessageInput): Promise<void> {
    this.assertCanWrite(input.toChatId, "any");
    await this.client.invoke({
      _: "forwardMessages",
      chat_id: Number(input.toChatId),
      from_chat_id: Number(input.fromChatId),
      message_ids: [Number(input.messageId)],
      send_copy: Boolean(input.hideSender),
      remove_caption: false,
    });
  }

  async setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    await this.client.invoke({
      _: "toggleChatIsPinned",
      chat_list: { _: "chatListMain" },
      chat_id: Number(chatId),
      is_pinned: pinned,
    });
  }

  async setChatMuted(chatId: string, muted: boolean): Promise<void> {
    await this.client.invoke({
      _: "setChatNotificationSettings",
      chat_id: Number(chatId),
      notification_settings: {
        _: "chatNotificationSettings",
        mute_for: muted ? 2147483647 : 0,
      },
    });
  }

  async setChatRead(chatId: string, read: boolean): Promise<void> {
    if (read) {
      const chat = this.chats.get(chatId);
      const lastId = chat?.last_message?.id;
      if (lastId) {
        await this.client.invoke({
          _: "viewMessages",
          chat_id: Number(chatId),
          message_ids: [lastId],
          force_read: true,
        });
      }
      return;
    }
    await this.client.invoke({
      _: "toggleChatIsMarkedAsUnread",
      chat_id: Number(chatId),
      is_marked_as_unread: true,
    });
  }

  async setChatArchived(chatId: string, archived: boolean): Promise<void> {
    await this.client.invoke({
      _: "addChatToList",
      chat_id: Number(chatId),
      chat_list: archived ? { _: "chatListArchive" } : { _: "chatListMain" },
    });
  }

  async setTyping(chatId: string, typing: boolean): Promise<void> {
    const chat = this.chats.get(chatId);
    if (chat && !this.writeAccess(chat).text) return;
    await this.client.invoke({
      _: "sendChatAction",
      chat_id: Number(chatId),
      action: typing ? { _: "chatActionTyping" } : { _: "chatActionCancel" },
    });
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
    this.assertCanWrite(chatId);
    await this.client.invoke({
      _: "setChatDraftMessage",
      chat_id: Number(chatId),
      draft_message: text
        ? {
            _: "draftMessage",
            content: {
              _: "draftMessageContentText",
              text: { _: "formattedText", text, entities: [] },
            },
          }
        : undefined,
    });
  }

  async answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    const payload = this.callbackData.get(`${chatId}:${messageId}:${buttonId}`);
    if (!payload) throw new Error("Unknown callback button");
    const answer = await this.client.invoke<Td.callbackQueryAnswer>({
      _: "getCallbackQueryAnswer",
      chat_id: Number(chatId),
      message_id: Number(messageId),
      payload: { _: "callbackQueryPayloadData", data: payload },
    });
    if (answer.url) return { kind: "url", url: answer.url };
    if (answer.text) {
      return { kind: "message", text: answer.text, alert: answer.show_alert };
    }
    return { kind: "none" };
  }

  async setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    const emoji = normalizeReactionEmoji(input.emoji);
    const reactionType = { _: "reactionTypeEmoji" as const, emoji };
    if (input.remove) {
      await this.client.invoke({
        _: "removeMessageReaction",
        chat_id: Number(input.chatId),
        message_id: Number(input.messageId),
        reaction_type: reactionType,
      });
      return;
    }
    // User accounts add/remove one reaction. `setMessageReactions` is bots-only
    // and TDLib rejects it with "Only bots can use the method".
    await this.client.invoke({
      _: "addMessageReaction",
      chat_id: Number(input.chatId),
      message_id: Number(input.messageId),
      reaction_type: reactionType,
      is_big: false,
      update_recent_reactions: true,
    });
  }

  async listAvailableReactions(
    chatId: string,
    messageId?: string,
  ): Promise<ReadonlyArray<string>> {
    if (messageId) {
      try {
        const available = await this.client.invoke<Td.availableReactions>({
          _: "getMessageAvailableReactions",
          chat_id: Number(chatId),
          message_id: Number(messageId),
          row_size: 8,
        });
        if (available._ === "availableReactions") {
          const emojis = mapAvailableReactionEmojis(available);
          if (emojis.length > 0) return emojis;
        }
      } catch {
        // A deleted or inaccessible message still has a chat reaction policy.
      }
    }
    return this.chatReactionEmojis(chatId);
  }

  private chatReactionEmojis(chatId: string): ReadonlyArray<string> {
    const available = this.chats.get(chatId)?.available_reactions;
    if (available?._ === "chatAvailableReactionsSome") {
      return mapReactionTypeEmojis(available.reactions);
    }
    return this.activeEmojiReactions.map(normalizeReactionEmoji);
  }

  /**
   * Telegram's answer to a click on an animated emoji. A 404 is a real answer
   * and not a failure: TDLib documents it as "usual animation needs to be
   * played", so the caller replays the bubble's own sticker. Anything else is
   * a genuine error and stays one.
   */
  async clickAnimatedEmoji(
    chatId: string,
    messageId: string,
  ): Promise<AnimatedEmojiEffectDto | null> {
    let sticker: Td.sticker;
    try {
      sticker = await this.client.invoke<Td.sticker>({
        _: "clickAnimatedEmojiMessage",
        chat_id: Number(chatId),
        message_id: Number(messageId),
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    return this.toAnimatedEmojiEffect(chatId, messageId, sticker);
  }

  private async toAnimatedEmojiEffect(
    chatId: string,
    messageId: string,
    sticker: Td.sticker,
  ): Promise<AnimatedEmojiEffectDto> {
    const media = stickerMedia(sticker, "emoji", sticker.emoji);
    return {
      chatId,
      messageId,
      mediaId: media.id,
      sticker: {
        emoji: media.sticker.emoji,
        role: media.sticker.role,
        format: media.sticker.format,
        setReference: media.sticker.setReference,
        outlinePath: await this.stickerOutlinePath(sticker.sticker.id),
      },
      width: media.width,
      height: media.height,
    };
  }

  async logout(): Promise<void> {
    await this.client.invoke({ _: "logOut" });
    this.unsubscribe?.();
  }

  dispose(): void {
    this.unsubscribe?.();
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
  }

  private nextSendingId(): number {
    const id = this.sendingId;
    this.sendingId += 1;
    return id;
  }

  private rememberClientId(
    sendingId: number,
    clientId: string | undefined,
  ): void {
    if (clientId) this.clientIds.set(`sid:${sendingId}`, clientId);
  }

  private bindPendingClientId(message: Td.message): string | undefined {
    const state = message.sending_state;
    if (state && state._ === "messageSendingStatePending") {
      const fromSid = this.clientIds.get(`sid:${state.sending_id}`);
      if (fromSid) this.clientIds.set(String(message.id), fromSid);
    }
    return this.clientIdFor(message.id, message.sending_state);
  }

  private clientIdFor(
    messageId: number,
    sendingState?: Td.message["sending_state"],
  ): string | undefined {
    const fromMessage = this.clientIds.get(String(messageId));
    if (fromMessage) return fromMessage;
    if (sendingState && sendingState._ === "messageSendingStatePending") {
      return this.clientIds.get(`sid:${sendingState.sending_id}`);
    }
    return undefined;
  }

  private async emitSendResult(
    message: Td.message,
    oldMessageId: number,
    failed: boolean,
  ): Promise<void> {
    this.bindPendingClientId(message);
    const clientId =
      this.clientIds.get(String(oldMessageId)) ??
      this.clientIdFor(message.id, message.sending_state);
    if (clientId) this.clientIds.set(String(message.id), clientId);
    if (oldMessageId !== message.id) {
      this.emit({
        type: "message-delete",
        chatId: chatIdOf(message.chat_id),
        messageIds: [messageIdOf(oldMessageId)],
      });
    }
    const dto = await this.toMessage(message);
    this.emit({
      type: "message-upsert",
      cause: "new",
      message: failed
        ? { ...dto, ...(clientId ? { clientId } : {}), status: "failed" }
        : clientId
          ? { ...dto, clientId }
          : dto,
    });
  }

  private async hydrateAvatarsFromDisk(): Promise<void> {
    const urls = await listCachedAvatarUrls(this.mediaCacheDirectory);
    for (const [peerId, url] of urls) {
      this.avatarUrls.set(peerId, url);
    }
  }

  private avatarIsPending(peerId: string): boolean {
    return !this.avatarUrls.has(peerId);
  }

  private hasCachedAvatarFile(peerId: string): boolean {
    return Boolean(this.avatarUrls.get(peerId)?.startsWith("telo-media:"));
  }

  private hasSharpCachedAvatar(peerId: string): boolean {
    const url = this.avatarUrls.get(peerId);
    return Boolean(url && isSharpAvatarCacheUrl(url));
  }

  private scheduleChatAvatar(chat: Td.chat): void {
    const peerId = chatIdOf(chat.id);
    this.paintMinithumbnail(peerId, chat.photo?.minithumbnail);
    const file = avatarFileFromPhotoInfo(chat.photo);
    if (file) {
      void this.downloadAvatar(peerId, file);
      return;
    }
    if (chat.type._ === "chatTypePrivate") {
      // Private-chat photos live on the user. A missing chat.photo is not
      // "confirmed empty" — hydrateUser / getUser owns that settlement.
      return;
    }
    if (!chat.photo) {
      this.settleEmptyAvatar(peerId);
    }
  }

  private scheduleUserAvatar(user: Td.user, wait = false): Promise<void> {
    const peerId = String(user.id);
    const photo = user.profile_photo;
    this.paintMinithumbnail(peerId, photo?.minithumbnail);
    if (photo === null || photo?.id === "0") {
      if (this.hasInFlightAvatar(peerId)) return Promise.resolve();
      if (avatarFileFromPhotoInfo(this.chats.get(peerId)?.photo)) {
        return Promise.resolve();
      }
      this.settleEmptyAvatar(peerId);
      return Promise.resolve();
    }
    const file = avatarFileFromPhotoInfo(photo);
    if (file) {
      return this.downloadAvatar(peerId, file, wait);
    }
    return this.scheduleUserAvatarFromFullInfo(user, wait);
  }

  private async scheduleUserAvatarFromFullInfo(
    user: Td.user,
    wait: boolean,
  ): Promise<void> {
    const peerId = String(user.id);
    try {
      const full = await this.client.invoke<Td.userFullInfo>({
        _: "getUserFullInfo",
        user_id: user.id,
      });
      const fromFull =
        full._ === "userFullInfo"
          ? (full.personal_photo ?? full.photo ?? full.public_photo)
          : undefined;
      if (fromFull) {
        this.paintMinithumbnail(peerId, fromFull.minithumbnail);
        const file = avatarFileFromChatPhoto(fromFull);
        if (file) await this.downloadAvatar(peerId, file, wait);
        return;
      }
      const photos = await this.client.invoke<Td.chatPhotos>({
        _: "getUserProfilePhotos",
        user_id: user.id,
        offset: 0,
        limit: 1,
      });
      const listed = photos._ === "chatPhotos" ? photos.photos[0] : undefined;
      if (listed) {
        this.paintMinithumbnail(peerId, listed.minithumbnail);
        const file = avatarFileFromChatPhoto(listed);
        if (file) await this.downloadAvatar(peerId, file, wait);
        return;
      }
      if (photos._ === "chatPhotos" && photos.total_count === 0) {
        this.settleEmptyAvatar(peerId);
      }
    } catch (error) {
      console.error("TDLib user photo lookup failed", {
        userId: user.id,
        error,
      });
    }
  }

  private paintMinithumbnail(
    peerId: string,
    mini: Td.minithumbnail | undefined,
  ): void {
    if (this.hasCachedAvatarFile(peerId)) return;
    const url = minithumbnailDataUrl(mini);
    if (url) this.settleAvatarUrl(peerId, url);
  }

  private settleEmptyAvatar(peerId: string): void {
    if (this.hasInFlightAvatar(peerId)) return;
    if (this.avatarUrls.get(peerId)) return;
    this.avatarUrls.set(peerId, null);
  }

  private avatarPlaceholderForPeer(
    peerId: string,
  ): AvatarPlaceholderDto | null {
    const user = this.users.get(Number(peerId));
    if (user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
      return mapAvatarPlaceholder(
        name || String(user.id),
        user.accent_color_id ?? 0,
        (colorId) => accentPaletteOf(colorId, this.customAccentColors),
      );
    }
    const chat = this.chats.get(peerId);
    if (!chat) return null;
    return mapAvatarPlaceholder(
      chat.title,
      chat.accent_color_id ?? 0,
      (colorId) => accentPaletteOf(colorId, this.customAccentColors),
    );
  }

  private hasInFlightAvatar(peerId: string): boolean {
    for (const mapped of this.avatarFilePeers.values()) {
      if (mapped === peerId) return true;
    }
    return false;
  }

  private async downloadAvatar(
    peerId: string,
    file: Td.file,
    wait = false,
  ): Promise<void> {
    const fileId = fileIdOf(file);
    if (fileId === null) return;
    if (this.hasSharpCachedAvatar(peerId)) return;
    this.avatarFilePeers.set(fileId, peerId);
    try {
      if (file.local?.is_downloading_completed && file.local.path) {
        await this.settleAvatar(peerId, file);
        return;
      }
      const downloaded = await this.client.invoke<Td.file>({
        _: "downloadFile",
        file_id: fileId,
        priority: 32,
        offset: 0,
        limit: 0,
        synchronous: wait,
      });
      const downloadedId = fileIdOf(downloaded) ?? fileId;
      this.avatarFilePeers.set(downloadedId, peerId);
      if (downloaded.local?.is_downloading_completed && downloaded.local.path) {
        await this.settleAvatar(peerId, downloaded);
      }
    } catch (error) {
      console.error("TDLib avatar download failed", {
        peerId,
        fileId,
        error,
      });
      if (!this.avatarUrls.get(peerId)) this.settleAvatarUrl(peerId, null);
    }
  }

  private async settleAvatar(peerId: string, file: Td.file): Promise<void> {
    const sourcePath = file.local?.path;
    if (!sourcePath) return;
    try {
      const fileName = avatarCacheFileName(peerId);
      await copyIntoMediaCache(sourcePath, this.mediaCacheDirectory, fileName);
      this.settleAvatarUrl(peerId, avatarMediaUrl(fileName));
    } catch (error) {
      console.error("TDLib avatar cache copy failed", { peerId, error });
      if (!this.avatarUrls.get(peerId)) this.settleAvatarUrl(peerId, null);
    }
  }

  private settleAvatarUrl(peerId: string, url: string | null): void {
    const previous = this.avatarUrls.get(peerId);
    if (previous?.startsWith("telo-media:") && url !== previous) {
      if (url === null || url.startsWith("data:")) return;
    }
    this.avatarUrls.set(peerId, url);
    this.emit({ type: "chat-avatar", chatId: peerId, avatarDataUrl: url });
  }

  private scheduleTypingExpiry(chatId: string): void {
    this.clearTyping(chatId, false);
    const timer = setTimeout(() => {
      this.typingTimers.delete(chatId);
      const chat = this.chats.get(chatId);
      if (!chat) return;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
    }, TYPING_EXPIRY_MS);
    this.typingTimers.set(chatId, timer);
  }

  private clearTyping(chatId: string, emit = true): void {
    const timer = this.typingTimers.get(chatId);
    if (timer) clearTimeout(timer);
    this.typingTimers.delete(chatId);
    if (!emit) return;
    const chat = this.chats.get(chatId);
    if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
  }

  private async hydratePrivateUser(userId: number): Promise<void> {
    await this.hydrateUser(userId);
  }

  private rememberUser(user: Td.user): void {
    const id = Number(user.id);
    const existing = this.users.get(id);
    if (
      avatarFileFromPhotoInfo(existing?.profile_photo) &&
      !avatarFileFromPhotoInfo(user.profile_photo)
    ) {
      return;
    }
    this.users.set(id, user);
  }

  private async resolveFullUser(user: Td.user): Promise<Td.user> {
    const id = Number(user.id);
    this.rememberUser(user);
    if (
      user.profile_photo === null ||
      avatarFileFromPhotoInfo(user.profile_photo)
    ) {
      this.fetchedUserIds.add(id);
      return this.users.get(id) ?? user;
    }
    if (this.fetchedUserIds.has(id)) {
      return this.users.get(id) ?? user;
    }
    return (await this.fetchUser(id)) ?? user;
  }

  private async fetchUser(userId: number): Promise<Td.user | null> {
    const id = Number(userId);
    this.fetchedUserIds.add(id);
    try {
      const user = await this.client.invoke<Td.user>({
        _: "getUser",
        user_id: id,
      });
      if (user._ === "user") {
        this.rememberUser(user);
        return user;
      }
    } catch (error) {
      console.error("TDLib getUser failed", { userId: id, error });
    }
    return this.users.get(id) ?? null;
  }

  private async hydrateUser(userId: number): Promise<void> {
    const id = Number(userId);
    const alreadyFetched = this.fetchedUserIds.has(id);
    if (!alreadyFetched) {
      await this.fetchUser(id);
    }
    const user = this.users.get(id);
    if (user) await this.scheduleUserAvatar(user);
    if (alreadyFetched) return;
    const chat = this.chats.get(String(id));
    if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
  }

  private async hydrateSender(sender: Td.MessageSender): Promise<void> {
    if (sender._ === "messageSenderUser") {
      await this.hydrateUser(sender.user_id);
    }
  }

  private async toChatMembers(
    members: ReadonlyArray<Td.chatMember>,
  ): Promise<ReadonlyArray<ChatMemberDto>> {
    const items: ChatMemberDto[] = [];
    for (const member of members) {
      if (member.member_id._ !== "messageSenderUser") continue;
      await this.hydrateUser(member.member_id.user_id);
      const user = this.users.get(member.member_id.user_id);
      const id = String(member.member_id.user_id);
      if (user) this.scheduleUserAvatar(user);
      const name = user
        ? [user.first_name, user.last_name].filter(Boolean).join(" ")
        : id;
      items.push({
        id,
        displayName: name,
        username: user?.usernames?.active_usernames[0] ?? null,
        avatarDataUrl: this.avatarUrls.get(id) ?? null,
        avatarPending: this.avatarIsPending(id),
        avatarPlaceholder:
          this.avatarPlaceholderForPeer(id) ??
          mapAvatarPlaceholder(name, 0, (colorId) =>
            accentPaletteOf(colorId, this.customAccentColors),
          ),
      });
    }
    return items;
  }

  private async hydrateBasicGroup(
    groupId: number,
    emit: boolean,
  ): Promise<void> {
    try {
      const group = await this.client.invoke<Td.basicGroup>({
        _: "getBasicGroup",
        basic_group_id: groupId,
      });
      if (group._ !== "basicGroup") return;
      this.basicGroups.set(group.id, group);
      if (emit) this.emitGroupChat(groupId, "chatTypeBasicGroup");
    } catch (error) {
      console.error("TDLib getBasicGroup failed", { groupId, error });
    }
  }

  private async hydrateSupergroup(
    supergroupId: number,
    emit: boolean,
  ): Promise<void> {
    try {
      const group = await this.client.invoke<Td.supergroup>({
        _: "getSupergroup",
        supergroup_id: supergroupId,
      });
      if (group._ !== "supergroup") return;
      this.supergroups.set(group.id, group);
      if (emit) this.emitGroupChat(supergroupId, "chatTypeSupergroup");
    } catch (error) {
      console.error("TDLib getSupergroup failed", { supergroupId, error });
    }
  }

  private async hydrateSecretChat(secretChatId: number): Promise<void> {
    if (this.secretChats.has(secretChatId)) return;
    try {
      const secret = await this.client.invoke<Td.secretChat>({
        _: "getSecretChat",
        secret_chat_id: secretChatId,
      });
      if (secret._ !== "secretChat") return;
      this.secretChats.set(secret.id, secret);
    } catch (error) {
      console.error("TDLib getSecretChat failed", { secretChatId, error });
    }
  }

  private secretStateOf(chat: Td.chat): ChatDto["secretState"] {
    if (chat.type._ !== "chatTypeSecret") return undefined;
    const secret = this.secretChats.get(chat.type.secret_chat_id);
    if (!secret) return "pending";
    if (secret.state._ === "secretChatStateReady") return "ready";
    if (secret.state._ === "secretChatStateClosed") return "closed";
    return "pending";
  }

  private async toStickerItem(sticker: Td.sticker): Promise<StickerItemDto> {
    this.stickersByFileId.set(sticker.sticker.id, sticker);
    const item = stickerItem(sticker);
    return {
      ...item,
      outlinePath: await this.stickerOutlinePath(sticker.sticker.id),
    };
  }

  private async stickerOutlinePath(fileId: number): Promise<string | null> {
    if (this.stickerOutlines.has(fileId)) {
      return this.stickerOutlines.get(fileId) ?? null;
    }
    try {
      const outline = await this.client.invoke<Td.text>({
        _: "getStickerOutlineSvgPath",
        sticker_file_id: fileId,
      });
      const path = outline._ === "text" && outline.text ? outline.text : null;
      this.stickerOutlines.set(fileId, path);
      return path;
    } catch (error) {
      console.error("TDLib sticker outline failed", { fileId, error });
      this.stickerOutlines.set(fileId, null);
      return null;
    }
  }

  private async handleUpdate(update: Td.Update): Promise<void> {
    if (update._ === "updateNewChat") {
      this.chats.set(chatIdOf(update.chat.id), update.chat);
      this.scheduleChatAvatar(update.chat);
      if (update.chat.type._ === "chatTypePrivate") {
        void this.hydratePrivateUser(update.chat.type.user_id);
      }
      if (update.chat.type._ === "chatTypeSecret") {
        void this.hydrateSecretChat(update.chat.type.secret_chat_id);
      }
      if (update.chat.type._ === "chatTypeBasicGroup") {
        await this.hydrateBasicGroup(update.chat.type.basic_group_id, false);
      }
      if (update.chat.type._ === "chatTypeSupergroup") {
        await this.hydrateSupergroup(update.chat.type.supergroup_id, false);
      }
      this.emit({ type: "chat-upsert", chat: this.toChat(update.chat) });
      return;
    }
    if (update._ === "updateChatPhoto") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      const peerId = chatIdOf(update.chat_id);
      this.avatarUrls.delete(peerId);
      chat.photo = update.photo;
      this.scheduleChatAvatar(chat);
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateSecretChat") {
      this.secretChats.set(update.secret_chat.id, update.secret_chat);
      const chat = [...this.chats.values()].find(
        (entry) =>
          entry.type._ === "chatTypeSecret" &&
          entry.type.secret_chat_id === update.secret_chat.id,
      );
      if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatPermissions") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.permissions = update.permissions;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatPosition") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      const positions = chat.positions.filter(
        (position) => position.list._ !== update.position.list._,
      );
      if (update.position.order !== "0") positions.push(update.position);
      chat.positions = positions;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatLastMessage") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.last_message = update.last_message;
      chat.positions = update.positions;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatReadInbox") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.last_read_inbox_message_id = update.last_read_inbox_message_id;
      chat.unread_count = update.unread_count;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      this.emit({
        type: "message-read",
        chatId: chatIdOf(update.chat_id),
        maxMessageId: messageIdOf(update.last_read_inbox_message_id),
        direction: "inbox",
      });
      return;
    }
    if (update._ === "updateChatReadOutbox") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.last_read_outbox_message_id = update.last_read_outbox_message_id;
      this.emit({
        type: "message-read",
        chatId: chatIdOf(update.chat_id),
        maxMessageId: messageIdOf(update.last_read_outbox_message_id),
        direction: "outbox",
      });
      return;
    }
    if (update._ === "updateChatDraftMessage") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.draft_message = update.draft_message;
      chat.positions = update.positions;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatTitle") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.title = update.title;
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateChatAvailableReactions") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      chat.available_reactions = update.available_reactions;
      return;
    }
    if (update._ === "updateActiveEmojiReactions") {
      this.activeEmojiReactions = update.emojis;
      return;
    }
    if (update._ === "updateNewMessage") {
      const clientId = this.bindPendingClientId(update.message);
      const dto = await this.toMessage(update.message);
      this.emit({
        type: "message-upsert",
        cause: "new",
        message: clientId ? { ...dto, clientId } : dto,
      });
      return;
    }
    if (update._ === "updateMessageSendSucceeded") {
      await this.emitSendResult(update.message, update.old_message_id, false);
      return;
    }
    if (update._ === "updateMessageSendFailed") {
      await this.emitSendResult(update.message, update.old_message_id, true);
      return;
    }
    if (update._ === "updateMessageContent") {
      const message = await this.client
        .invoke<Td.message>({
          _: "getMessage",
          chat_id: update.chat_id,
          message_id: update.message_id,
        })
        .catch(() => null);
      if (!message) return;
      this.emit({
        type: "message-upsert",
        cause: "edited",
        message: await this.toMessage(message),
      });
      return;
    }
    if (update._ === "updateDeleteMessages" && update.is_permanent) {
      this.emit({
        type: "message-delete",
        chatId: chatIdOf(update.chat_id),
        messageIds: update.message_ids.map(messageIdOf),
      });
      return;
    }
    if (update._ === "updateAnimatedEmojiMessageClicked") {
      // The peer clicked their own animated emoji; Telegram pushes the effect
      // so both sides see the same burst. The renderer decides whether the
      // message is on screen — a burst over a message scrolled out of view
      // would be a jump-scare with no cause.
      this.emit({
        type: "animated-emoji-clicked",
        effect: await this.toAnimatedEmojiEffect(
          chatIdOf(update.chat_id),
          messageIdOf(update.message_id),
          update.sticker,
        ),
      });
      return;
    }
    if (update._ === "updateMessageInteractionInfo") {
      this.emit({
        type: "message-reactions",
        chatId: chatIdOf(update.chat_id),
        messageId: messageIdOf(update.message_id),
        reactions: mapReactions(update.interaction_info) ?? [],
      });
      return;
    }
    if (update._ === "updateUserStatus") {
      const user = this.users.get(update.user_id);
      if (user) user.status = update.status;
      const chat = [...this.chats.values()].find(
        (entry) =>
          entry.type._ === "chatTypePrivate" &&
          entry.type.user_id === update.user_id,
      );
      if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateUser") {
      this.rememberUser(update.user);
      this.scheduleUserAvatar(update.user);
      const chat = this.chats.get(String(update.user.id));
      if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateBasicGroup") {
      this.basicGroups.set(update.basic_group.id, update.basic_group);
      this.emitGroupChat(update.basic_group.id, "chatTypeBasicGroup");
      return;
    }
    if (update._ === "updateSupergroup") {
      this.supergroups.set(update.supergroup.id, update.supergroup);
      this.emitGroupChat(update.supergroup.id, "chatTypeSupergroup");
      return;
    }
    if (update._ === "updateChatAction") {
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      const typing = update.action._ === "chatActionTyping";
      if (typing) this.scheduleTypingExpiry(chatIdOf(update.chat_id));
      else this.clearTyping(chatIdOf(update.chat_id));
      this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
      return;
    }
    if (update._ === "updateConnectionState") {
      this.emit({
        type: "connection-state",
        state: mapConnectionState(update.state),
      });
      return;
    }
    if (update._ === "updateFile") {
      await this.handleFile(update.file);
      return;
    }
    if (update._ === "updateChatFolders") {
      this.folders.splice(0, this.folders.length, ...update.chat_folders);
      this.emit({ type: "folders", folders: this.folderDtos() });
      return;
    }
    if (update._ === "updateAccentColors") {
      this.customAccentColors.clear();
      for (const color of update.colors) {
        this.customAccentColors.set(color.id, color);
      }
      this.emit({
        type: "chats",
        chats: this.orderedChats(),
        nextCursor: null,
      });
      return;
    }
  }

  private async handleFile(file: Td.file): Promise<void> {
    const fileId = fileIdOf(file);
    const avatarPeerId =
      fileId === null ? undefined : this.avatarFilePeers.get(fileId);
    if (avatarPeerId) {
      if (file.local?.is_downloading_completed && file.local.path) {
        await this.settleAvatar(avatarPeerId, file);
      }
      return;
    }
    const mediaId = mediaIdForFile(file.id);
    if (file.local.is_downloading_completed && file.local.path) {
      const fileName = `tdfile_${file.id}${path.extname(file.local.path)}`;
      const cached = await copyIntoMediaCache(
        file.local.path,
        this.mediaCacheDirectory,
        fileName,
      );
      this.filePaths.set(mediaId, cached);
      await enforceMediaCacheLimit(
        this.mediaCacheDirectory,
        await this.mediaCacheLimitBytes(),
      );
      this.emit({
        type: "media-download",
        mediaId,
        state: "ready",
        downloadedBytes: file.local.downloaded_size,
        totalBytes: file.size,
        url: `telo-media://cache/${fileName}`,
        error: null,
      });
      return;
    }
    if (file.local.is_downloading_active) {
      this.emit({
        type: "media-download",
        mediaId,
        state: "downloading",
        downloadedBytes: file.local.downloaded_size,
        totalBytes: file.size,
        url: null,
        error: null,
      });
    }
  }

  private async loadList(chatList: Td.ChatList$Input): Promise<void> {
    try {
      await this.client.invoke({
        _: "loadChats",
        chat_list: chatList,
        limit: 200,
      });
    } catch {
      // TDLib 404 = no more chats in this list.
    }
    const chats = await this.client.invoke<Td.chats>({
      _: "getChats",
      chat_list: chatList,
      limit: 200,
    });
    const pendingUsers: Promise<void>[] = [];
    for (const id of chats.chat_ids) {
      const chat = await this.client.invoke<Td.chat>({
        _: "getChat",
        chat_id: id,
      });
      this.chats.set(chatIdOf(chat.id), chat);
      this.scheduleChatAvatar(chat);
      if (chat.type._ === "chatTypePrivate") {
        pendingUsers.push(this.hydratePrivateUser(chat.type.user_id));
      }
      if (chat.type._ === "chatTypeSecret") {
        void this.hydrateSecretChat(chat.type.secret_chat_id);
      }
      if (chat.type._ === "chatTypeBasicGroup") {
        pendingUsers.push(
          this.hydrateBasicGroup(chat.type.basic_group_id, false),
        );
      }
      if (chat.type._ === "chatTypeSupergroup") {
        pendingUsers.push(
          this.hydrateSupergroup(chat.type.supergroup_id, false),
        );
      }
    }
    await Promise.all(pendingUsers);
  }

  private orderedChats(): ChatDto[] {
    return [...this.chats.values()]
      .map((chat) => this.toChat(chat))
      .sort((left, right) =>
        compareListOrder(left.listOrder ?? "0", right.listOrder ?? "0"),
      );
  }

  private async acceptCreatedChat(chat: Td.chat): Promise<ChatDto> {
    this.chats.set(chatIdOf(chat.id), chat);
    this.scheduleChatAvatar(chat);
    if (chat.type._ === "chatTypePrivate") {
      await this.hydratePrivateUser(chat.type.user_id);
    } else if (chat.type._ === "chatTypeSecret") {
      await this.hydrateSecretChat(chat.type.secret_chat_id);
    }
    const dto = this.toChat(chat);
    this.emit({ type: "chat-upsert", chat: dto });
    return dto;
  }

  private folderDtos(): ReadonlyArray<ChatFolderDto> {
    return mapFolders(this.folders, this.orderedChats());
  }

  private toChat(chat: Td.chat): ChatDto {
    const mapped = mapChat(chat, {
      selfUserId: this.selfUserId,
      avatarUrl: (peerId) => this.avatarUrls.get(peerId) ?? null,
      avatarPending: (peerId) => this.avatarIsPending(peerId),
      canSendMessages: (entry) => this.writeAccess(entry).text,
      canSendStickers: (entry) => this.writeAccess(entry).stickers,
      canSendMedia: (entry) => this.writeAccess(entry).media,
      accentPalette: (colorId) =>
        accentPaletteOf(colorId, this.customAccentColors),
      avatarPlaceholder: (peerId) => this.avatarPlaceholderForPeer(peerId),
    });
    const typing = this.typingTimers.has(chatIdOf(chat.id));
    let next: ChatDto = { ...mapped, typing };
    if (mapped.kind === "direct" && chat.type._ === "chatTypePrivate") {
      const user = this.users.get(chat.type.user_id);
      if (user) {
        const name = [user.first_name, user.last_name]
          .filter(Boolean)
          .join(" ");
        next = {
          ...next,
          avatarPlaceholder: mapAvatarPlaceholder(
            name || chat.title,
            user.accent_color_id ?? 0,
            (colorId) => accentPaletteOf(colorId, this.customAccentColors),
          ),
        };
      }
      if (user?.status._ === "userStatusOnline") {
        next = { ...next, presence: "online" };
      }
    }
    if (mapped.kind === "secret") {
      next = { ...next, secretState: this.secretStateOf(chat) };
    }
    return next;
  }

  private emitGroupChat(
    groupId: number,
    type: "chatTypeBasicGroup" | "chatTypeSupergroup",
  ): void {
    const chat = [...this.chats.values()].find(
      (entry) =>
        entry.type._ === type &&
        (type === "chatTypeBasicGroup"
          ? entry.type._ === "chatTypeBasicGroup" &&
            entry.type.basic_group_id === groupId
          : entry.type._ === "chatTypeSupergroup" &&
            entry.type.supergroup_id === groupId),
    );
    if (chat) this.emit({ type: "chat-upsert", chat: this.toChat(chat) });
  }

  private writeAccess(chat: Td.chat): {
    text: boolean;
    stickers: boolean;
    media: boolean;
  } {
    const none = { text: false, stickers: false, media: false };
    const all = { text: true, stickers: true, media: true };
    if (chat.type._ === "chatTypePrivate") {
      return this.users.get(chat.type.user_id)?.type._ === "userTypeDeleted"
        ? none
        : all;
    }
    if (chat.type._ === "chatTypeSecret") {
      return this.secretStateOf(chat) === "ready" ? all : none;
    }
    const channel =
      chat.type._ === "chatTypeSupergroup" && chat.type.is_channel;
    const status =
      chat.type._ === "chatTypeBasicGroup"
        ? this.basicGroups.get(chat.type.basic_group_id)?.status
        : this.supergroups.get(chat.type.supergroup_id)?.status;
    if (!status) return none;
    if (status._ === "chatMemberStatusCreator") return all;
    if (status._ === "chatMemberStatusAdministrator") {
      return !channel || status.rights.can_post_messages === true ? all : none;
    }
    if (status._ === "chatMemberStatusRestricted") {
      return status.is_member
        ? this.permissionsAccess(status.permissions)
        : none;
    }
    return status._ === "chatMemberStatusMember" && !channel
      ? this.permissionsAccess(chat.permissions)
      : none;
  }

  private permissionsAccess(permissions: Td.chatPermissions | undefined): {
    text: boolean;
    stickers: boolean;
    media: boolean;
  } {
    return {
      text: permissions?.can_send_basic_messages === true,
      stickers: permissions?.can_send_other_messages === true,
      media:
        permissions?.can_send_photos === true ||
        permissions?.can_send_videos === true ||
        permissions?.can_send_documents === true,
    };
  }

  private assertCanWrite(
    chatId: string,
    kind: "text" | "stickers" | "media" | "any" = "text",
  ): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    const access = this.writeAccess(chat);
    const allowed =
      kind === "any"
        ? access.text || access.stickers || access.media
        : access[kind];
    if (allowed) return;
    throw new Error(
      kind === "stickers"
        ? "The current account can't send stickers to this chat"
        : kind === "media"
          ? "The current account can't send media to this chat"
          : "The current account can't write to this chat",
    );
  }

  private async toMessage(message: Td.message): Promise<MessageDto> {
    this.indexKeyboard(message);
    await this.hydrateSender(message.sender_id);
    const origin = message.forward_info?.origin;
    if (origin?._ === "messageOriginUser") {
      await this.hydrateUser(origin.sender_user_id);
    }
    const chat = this.chats.get(chatIdOf(message.chat_id));
    const context: MessageMapContext = {
      selfUserId: this.selfUserId,
      avatarUrl: (peerId) => this.avatarUrls.get(peerId) ?? null,
      avatarPending: (peerId) => this.avatarIsPending(peerId),
      accentPalette: (colorId) =>
        accentPaletteOf(colorId, this.customAccentColors),
      avatarPlaceholder: (peerId) => this.avatarPlaceholderForPeer(peerId),
      senderName: (sender) => this.senderName(sender),
      senderId: (sender) =>
        sender._ === "messageSenderUser"
          ? String(sender.user_id)
          : String(sender.chat_id),
      lastReadOutboxMessageId: chat?.last_read_outbox_message_id,
    };
    const dto = mapMessage(message, context);
    const withReply = await this.hydrateReply(dto, message);
    if (withReply.media?.kind === "sticker" && withReply.media.sticker) {
      const fileId = fileIdFromMediaId(withReply.media.id);
      if (fileId !== null) {
        const outlinePath = await this.stickerOutlinePath(fileId);
        return {
          ...withReply,
          media: {
            ...withReply.media,
            sticker: { ...withReply.media.sticker, outlinePath },
          },
        };
      }
    }
    return withReply;
  }

  private async hydrateReply(
    dto: MessageDto,
    message: Td.message,
  ): Promise<MessageDto> {
    if (!dto.replyTo || (dto.replyTo.senderName && dto.replyTo.body)) {
      return dto;
    }
    const replied = await this.client
      .invoke<Td.message>({
        _: "getRepliedMessage",
        chat_id: message.chat_id,
        message_id: message.id,
      })
      .catch(() => null);
    if (!replied || replied._ !== "message") return dto;
    await this.hydrateSender(replied.sender_id);
    const mapped = mapMessage(replied, {
      selfUserId: this.selfUserId,
      avatarUrl: () => null,
      avatarPending: () => false,
      senderName: (sender) => this.senderName(sender),
      senderId: (sender) =>
        sender._ === "messageSenderUser"
          ? String(sender.user_id)
          : String(sender.chat_id),
    });
    return {
      ...dto,
      replyTo: {
        id: mapped.id,
        senderName: mapped.senderName,
        body: mapped.body || dto.replyTo.body,
        entities: mapped.entities.length
          ? mapped.entities
          : dto.replyTo.entities,
      },
    };
  }

  private senderName(sender: Td.MessageSender): string {
    if (sender._ === "messageSenderUser") {
      const user = this.users.get(sender.user_id);
      if (user)
        return [user.first_name, user.last_name].filter(Boolean).join(" ");
      return String(sender.user_id);
    }
    return (
      this.chats.get(chatIdOf(sender.chat_id))?.title ?? String(sender.chat_id)
    );
  }

  private indexKeyboard(message: Td.message): void {
    const markup = message.reply_markup;
    if (!markup || markup._ !== "replyMarkupInlineKeyboard") return;
    markup.rows.forEach((row, rowIndex) => {
      row.forEach((button, columnIndex) => {
        if (button.type._ !== "inlineKeyboardButtonTypeCallback") return;
        this.callbackData.set(
          `${chatIdOf(message.chat_id)}:${messageIdOf(message.id)}:${rowIndex}:${columnIndex}`,
          button.type.data,
        );
      });
    });
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function inputContentForFile(
  file: TelegramUploadFile,
  caption: Td.formattedText$Input | undefined,
): Td.InputMessageContent$Input {
  const localFile = { _: "inputFileLocal" as const, path: file.source };
  if (file.mimeType.startsWith("image/")) {
    return {
      _: "inputMessagePhoto",
      photo: { _: "inputPhoto", photo: localFile },
      caption,
    };
  }
  if (file.mimeType.startsWith("video/")) {
    return {
      _: "inputMessageVideo",
      video: {
        _: "inputVideo",
        video: localFile,
        supports_streaming: true,
      },
      caption,
    };
  }
  return {
    _: "inputMessageDocument",
    document: { _: "inputDocument", document: localFile },
    caption,
  };
}

function stickerItem(sticker: Td.sticker): StickerItemDto {
  const format =
    sticker.format._ === "stickerFormatTgs"
      ? "animated"
      : sticker.format._ === "stickerFormatWebm"
        ? "video"
        : "static";
  return {
    id: mediaIdForFile(sticker.sticker.id),
    emoji: sticker.emoji || null,
    format,
    width: sticker.width,
    height: sticker.height,
    outlinePath: null,
  };
}

function isStickerFileNotReady(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /FILE|DOWNLOAD|not found|not downloaded/i.test(text);
}

function toTdEntity(entity: MessageEntityDto): Td.textEntity$Input {
  const base = {
    _: "textEntity" as const,
    offset: entity.offset,
    length: entity.length,
  };
  switch (entity.type) {
    case "bold":
      return { ...base, type: { _: "textEntityTypeBold" } };
    case "italic":
      return { ...base, type: { _: "textEntityTypeItalic" } };
    case "code":
      return { ...base, type: { _: "textEntityTypeCode" } };
    case "underline":
      return { ...base, type: { _: "textEntityTypeUnderline" } };
    case "strikethrough":
      return { ...base, type: { _: "textEntityTypeStrikethrough" } };
    case "spoiler":
      return { ...base, type: { _: "textEntityTypeSpoiler" } };
    case "pre":
      return {
        ...base,
        type: { _: "textEntityTypePreCode", language: entity.language },
      };
    case "text-link":
      return { ...base, type: { _: "textEntityTypeTextUrl", url: entity.url } };
    case "text-mention":
      return {
        ...base,
        type: {
          _: "textEntityTypeMentionName",
          user_id: Number(entity.userId),
        },
      };
    case "custom-emoji":
      return {
        ...base,
        type: {
          _: "textEntityTypeCustomEmoji",
          custom_emoji_id: entity.documentId,
        },
      };
    default:
      return { ...base, type: { _: "textEntityTypeBold" } };
  }
}

export interface TdlibClientCoordinatorOptions {
  readonly database: TelegramAccountDatabase;
  readonly profiles: TelegramConnectionProfileRepository;
  readonly applicationCredentials: {
    readonly apiId: number;
    readonly apiHash: string;
  } | null;
  readonly onState: (state: TelegramAuthState) => void;
  readonly mediaCacheDirectory: string;
  readonly mediaCacheLimitBytes: () => Promise<number>;
  readonly resolveTdjson: () => TdjsonResolveOptions;
}

export class TdlibClientCoordinator implements TelegramAccountClient {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private repository: TelegramRepository;
  private unsubscribeRepository: () => void;
  private state: TelegramAuthState = { status: "idle" };
  private client: TdlibBridge | null = null;
  private live: TdlibTelegramRepository | null = null;
  private pendingAuth: Td.AuthorizationState | null = null;

  constructor(private readonly options: TdlibClientCoordinatorOptions) {
    this.repository = new DemoTelegramRepository({
      mediaCacheDirectory: options.mediaCacheDirectory || undefined,
      mediaCacheLimitBytes: options.mediaCacheLimitBytes,
    });
    this.unsubscribeRepository = this.repository.subscribe((event) =>
      this.publish(event),
    );
  }

  subscribe(listener: (event: TelegramWorkspaceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAuthState(): TelegramAuthState {
    return this.state;
  }

  async getLoginConfiguration(): Promise<TelegramLoginConfigurationDto> {
    return {
      applicationCredentialsConfigured: Boolean(
        this.options.applicationCredentials ??
        (await this.options.profiles.get()),
      ),
    };
  }

  async initialize(): Promise<void> {
    const credentials =
      this.options.applicationCredentials ??
      (await this.options.profiles.get());
    if (!credentials) return;
    this.setState({ status: "restoring" });
    try {
      await this.openClient(credentials.apiId, credentials.apiHash);
    } catch (error) {
      this.setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async beginLogin(input: TelegramLoginInput): Promise<void> {
    const saved = await this.options.profiles.get();
    const apiId =
      this.options.applicationCredentials?.apiId ?? saved?.apiId ?? input.apiId;
    const apiHash =
      this.options.applicationCredentials?.apiHash ??
      saved?.apiHash ??
      input.apiHash?.trim();
    if (!Number.isInteger(apiId) || !apiId || apiId <= 0) {
      throw new Error("Telegram API id is invalid");
    }
    if (!apiHash) throw new Error("Telegram API hash is required");
    if (!input.phoneNumber.trim()) throw new Error("Phone number is required");
    await this.disconnect();
    this.setState({ status: "connecting" });
    await this.openClient(apiId, apiHash);
    await this.options.profiles.save({
      apiId,
      apiHash,
      phoneNumber: input.phoneNumber.trim(),
    });
    await this.client?.invoke({
      _: "setAuthenticationPhoneNumber",
      phone_number: input.phoneNumber.trim(),
    });
  }

  async submitChallenge(value: string): Promise<void> {
    if (!value.trim()) throw new Error("Telegram login value is required");
    const state = this.pendingAuth;
    if (!state)
      throw new Error("Telegram is not waiting for a login challenge");
    this.setState({ status: "connecting" });
    if (state._ === "authorizationStateWaitCode") {
      await this.client?.invoke({
        _: "checkAuthenticationCode",
        code: value.trim(),
      });
      return;
    }
    if (state._ === "authorizationStateWaitPassword") {
      await this.client?.invoke({
        _: "checkAuthenticationPassword",
        password: value.trim(),
      });
      return;
    }
    throw new Error("Telegram is not waiting for a login challenge");
  }

  async disconnect(): Promise<void> {
    this.live?.dispose();
    this.live = null;
    if (this.client && !this.client.isClosed()) await this.client.close();
    this.client = null;
    this.replaceRepository(
      new DemoTelegramRepository({
        mediaCacheDirectory: this.options.mediaCacheDirectory || undefined,
        mediaCacheLimitBytes: this.options.mediaCacheLimitBytes,
      }),
    );
    this.setState({ status: "idle" });
  }

  async logout(): Promise<void> {
    try {
      await this.live?.logout();
    } finally {
      await this.disconnect();
      await this.options.database.clear();
    }
  }

  subscribeRepository(
    listener: (event: TelegramWorkspaceEvent) => void,
  ): () => void {
    return this.repository.subscribe(listener);
  }

  getCurrentUser(): Promise<CurrentUserDto> {
    return this.repository.getCurrentUser();
  }
  listChatPage(input: ChatPageInput): Promise<ChatPageDto> {
    return this.repository.listChatPage(input);
  }
  createSecretChat(userId: string): Promise<ChatDto> {
    return this.repository.createSecretChat(userId);
  }
  listContacts(): Promise<ReadonlyArray<TelegramContactDto>> {
    return this.repository.listContacts();
  }
  openPrivateChat(userId: string): Promise<ChatDto> {
    return this.repository.openPrivateChat(userId);
  }
  createGroup(input: CreateTelegramGroupInput): Promise<ChatDto> {
    return this.repository.createGroup(input);
  }
  createChannel(input: CreateTelegramChannelInput): Promise<ChatDto> {
    return this.repository.createChannel(input);
  }
  listCalls(cursor: string | null = null): Promise<TelegramCallPageDto> {
    return this.repository.listCalls(cursor);
  }
  postStory(
    file: TelegramUploadFile,
    input: PostStoryInput,
  ): Promise<PostedStoryDto> {
    return this.repository.postStory(file, input);
  }
  openSavedMessages(): Promise<ChatDto> {
    return this.repository.openSavedMessages();
  }
  listFolders(): Promise<ReadonlyArray<ChatFolderDto>> {
    return this.repository.listFolders();
  }
  listMessagePage(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.repository.listMessagePage(chatId, input);
  }
  listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    return this.repository.listSharedMedia(chatId, input);
  }
  listPinnedMessages(chatId: string): Promise<ReadonlyArray<MessageDto>> {
    return this.repository.listPinnedMessages(chatId);
  }
  listChatMembers(chatId: string): Promise<ReadonlyArray<ChatMemberDto>> {
    return this.repository.listChatMembers(chatId);
  }
  getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    return this.repository.getPeerProfile(peerId);
  }
  listStickerSets(): Promise<ReadonlyArray<StickerSetDto>> {
    return this.repository.listStickerSets();
  }
  getStickerCatalog(): Promise<StickerCatalogDto> {
    return this.repository.getStickerCatalog();
  }
  reorderStickerSets(setIds: ReadonlyArray<string>): Promise<void> {
    return this.repository.reorderStickerSets(setIds);
  }
  setStickerFavorite(stickerId: string, favorite: boolean): Promise<void> {
    return this.repository.setStickerFavorite(stickerId, favorite);
  }
  removeRecentSticker(stickerId: string): Promise<void> {
    return this.repository.removeRecentSticker(stickerId);
  }
  clearRecentStickers(): Promise<void> {
    return this.repository.clearRecentStickers();
  }
  searchStickers(query: string): Promise<ReadonlyArray<StickerItemDto>> {
    return this.repository.searchStickers(query);
  }
  sendSticker(
    chatId: string,
    stickerId: string,
    clientId?: string,
  ): Promise<MessageDto> {
    return this.repository.sendSticker(chatId, stickerId, clientId);
  }
  getStickerSet(reference: StickerSetReferenceDto): Promise<StickerSetDto> {
    return this.repository.getStickerSet(reference);
  }
  setStickerSetInstalled(shortName: string, installed: boolean): Promise<void> {
    return this.repository.setStickerSetInstalled(shortName, installed);
  }
  getCustomEmoji(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<StickerItemDto>> {
    return this.repository.getCustomEmoji(documentIds);
  }
  searchGlobal(query: string): Promise<GlobalSearchResultDto> {
    return this.repository.searchGlobal(query);
  }
  searchMessages(
    chatId: string,
    query: string,
    input: MessageSearchPageInput,
  ): Promise<MessageSearchPageDto> {
    return this.repository.searchMessages(chatId, query, input);
  }
  sendMessage(
    chatId: string,
    body: string,
    replyToId?: string,
    clientId?: string,
    silent?: boolean,
    entities?: ReadonlyArray<MessageEntityDto>,
  ): Promise<MessageDto> {
    return this.repository.sendMessage(
      chatId,
      body,
      replyToId,
      clientId,
      silent,
      entities,
    );
  }
  downloadMedia(mediaId: string): Promise<void> {
    return this.repository.downloadMedia(mediaId);
  }
  cancelMediaDownload(mediaId: string): Promise<void> {
    return this.repository.cancelMediaDownload(mediaId);
  }
  resolveMediaFile(mediaId: string): Promise<string> {
    return this.repository.resolveMediaFile(mediaId);
  }
  sendMedia(
    chatId: string,
    files: ReadonlyArray<TelegramUploadFile>,
    caption: string,
    replyToId: string | undefined,
    clientId: string | undefined,
    uploadId: string,
  ): Promise<ReadonlyArray<MessageDto>> {
    return this.repository.sendMedia(
      chatId,
      files,
      caption,
      replyToId,
      clientId,
      uploadId,
    );
  }
  cancelMediaUpload(uploadId: string): Promise<void> {
    return this.repository.cancelMediaUpload(uploadId);
  }
  editMessage(input: EditMessageInput): Promise<void> {
    return this.repository.editMessage(input);
  }
  deleteMessage(input: DeleteMessageInput): Promise<void> {
    return this.repository.deleteMessage(input);
  }
  forwardMessage(input: ForwardMessageInput): Promise<void> {
    return this.repository.forwardMessage(input);
  }
  setChatPinned(chatId: string, pinned: boolean): Promise<void> {
    return this.repository.setChatPinned(chatId, pinned);
  }
  setChatMuted(chatId: string, muted: boolean): Promise<void> {
    return this.repository.setChatMuted(chatId, muted);
  }
  setChatRead(chatId: string, read: boolean): Promise<void> {
    return this.repository.setChatRead(chatId, read);
  }
  setChatArchived(chatId: string, archived: boolean): Promise<void> {
    return this.repository.setChatArchived(chatId, archived);
  }
  setTyping(chatId: string, typing: boolean): Promise<void> {
    return this.repository.setTyping(chatId, typing);
  }
  saveDraft(chatId: string, text: string): Promise<void> {
    return this.repository.saveDraft(chatId, text);
  }
  answerBotCallback(
    chatId: string,
    messageId: string,
    buttonId: string,
  ): Promise<BotCallbackAnswerDto> {
    return this.repository.answerBotCallback(chatId, messageId, buttonId);
  }
  setMessageReaction(input: SetMessageReactionInput): Promise<void> {
    return this.repository.setMessageReaction(input);
  }
  listAvailableReactions(
    chatId: string,
    messageId?: string,
  ): Promise<ReadonlyArray<string>> {
    return this.repository.listAvailableReactions(chatId, messageId);
  }

  clickAnimatedEmoji(
    chatId: string,
    messageId: string,
  ): Promise<AnimatedEmojiEffectDto | null> {
    return this.repository.clickAnimatedEmoji(chatId, messageId);
  }

  private async openClient(apiId: number, apiHash: string): Promise<void> {
    configureTdlib(this.options.resolveTdjson());
    const encryptionKey = await this.options.database.encryptionKey();
    const client = createTdlibBridge({
      apiId,
      apiHash,
      databaseDirectory: this.options.database.directory,
      filesDirectory: path.join(this.options.database.directory, "files"),
      databaseEncryptionKey: encryptionKey,
      useMessageDatabase: true,
      useSecretChats: true,
    });
    this.client = client;
    client.onUpdate((update) => {
      if (update._ !== "updateAuthorizationState") return;
      void this.handleAuthorization(update.authorization_state);
    });
  }

  private async handleAuthorization(
    state: Td.AuthorizationState,
  ): Promise<void> {
    this.pendingAuth = state;
    const status = mapAuthorizationStatus(state);
    if (state._ === "authorizationStateWaitPassword") {
      this.setState({
        status: "password-required",
        hint: state.password_hint || null,
      });
      return;
    }
    if (status === "ready") {
      if (!this.client) return;
      const live = new TdlibTelegramRepository(
        this.client,
        this.options.mediaCacheDirectory,
        this.options.mediaCacheLimitBytes,
      );
      this.live = live;
      this.replaceRepository(live);
      await live.hydrate();
      this.setState({ status: "ready" });
      return;
    }
    if (status === "code-required") {
      this.setState({ status: "code-required" });
      return;
    }
    if (status !== "idle") this.setState({ status: "connecting" });
  }

  private replaceRepository(repository: TelegramRepository): void {
    this.unsubscribeRepository();
    this.repository = repository;
    this.unsubscribeRepository = repository.subscribe((event) =>
      this.publish(event),
    );
  }

  private publish(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setState(state: TelegramAuthState): void {
    this.state = state;
    this.options.onState(state);
  }
}

function fileIdOf(file: Td.file | undefined): number | null {
  if (file?.id == null || file.id === 0) return null;
  const id = Number(file.id);
  return Number.isFinite(id) && id !== 0 ? id : null;
}

function avatarFileFromPhotoInfo(
  photo: { small?: Td.file; big?: Td.file } | undefined | null,
): Td.file | undefined {
  if (!photo) return undefined;
  if (fileIdOf(photo.big) !== null) return photo.big;
  if (fileIdOf(photo.small) !== null) return photo.small;
  return undefined;
}

/** Covers an 80px profile disc at 2–3× device pixel ratio. */
const AVATAR_SHARP_EDGE_PX = 320;
const AVATAR_USABLE_EDGE_PX = 160;

/**
 * Smallest square that still meets the sharp floor; otherwise the smallest
 * size of at least 160px; otherwise the largest available file. Never the
 * 40–90px `s` thumbnail that a min-area pick would choose.
 */
function avatarFileFromChatPhoto(photo: Td.chatPhoto): Td.file | undefined {
  const sizes = photo.sizes;
  if (!sizes.length) return undefined;
  const sharp = sizes.filter(
    (size) => Math.min(size.width, size.height) >= AVATAR_SHARP_EDGE_PX,
  );
  const usable = sizes.filter(
    (size) => Math.min(size.width, size.height) >= AVATAR_USABLE_EDGE_PX,
  );
  const pool = sharp.length > 0 ? sharp : usable.length > 0 ? usable : sizes;
  const preferSmallest = sharp.length > 0 || usable.length > 0;
  return pool.reduce((best, size) => {
    const area = size.width * size.height;
    const bestArea = best.width * best.height;
    if (preferSmallest) return area < bestArea ? size : best;
    return area > bestArea ? size : best;
  }).photo;
}

/**
 * TDLib reports "no such thing" as an error object carrying HTTP-shaped
 * `code`/`message` fields. Some calls document a 404 as a normal answer -
 * `clickAnimatedEmojiMessage` uses it for "this emoji has no big effect" -
 * so those callers need to tell it apart from a real failure rather than
 * swallowing every error alike.
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 404
  );
}
