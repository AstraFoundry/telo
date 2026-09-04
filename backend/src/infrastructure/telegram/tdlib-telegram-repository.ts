import path from "node:path";

import type * as Td from "tdlib-types";

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
  MessagePageDto,
  MessagePageInput,
  MessageSearchPageDto,
  MessageSearchPageInput,
  PeerProfileDto,
  SetMessageReactionInput,
  StickerCatalogDto,
  StickerItemDto,
  StickerSetDto,
  StickerSetReferenceDto,
  TelegramAuthState,
  TelegramLoginConfigurationDto,
  TelegramLoginInput,
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
  chatIdOf,
  compareListOrder,
  fileIdFromMediaId,
  initials,
  mapAuthorizationStatus,
  mapChat,
  mapConnectionState,
  mapFolders,
  mapMessage,
  mediaIdForFile,
  messageIdOf,
  type MessageMapContext,
} from "./tdlib-mappers";
import { copyIntoMediaCache } from "./file-telegram-account-database";
import { enforceMediaCacheLimit } from "./media-cache";
import type { TelegramAccountClient } from "./telegram-account-coordinator";

export class TdlibTelegramRepository implements TelegramRepository {
  private readonly listeners = new Set<
    (event: TelegramWorkspaceEvent) => void
  >();
  private readonly chats = new Map<string, Td.chat>();
  private readonly users = new Map<number, Td.user>();
  private readonly folders: Td.chatFolderInfo[] = [];
  private readonly clientIds = new Map<string, string>();
  private readonly callbackData = new Map<string, string>();
  private readonly filePaths = new Map<string, string>();
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
    const me = await this.client.invoke<Td.user>({ _: "getMe" });
    this.selfUserId = me.id;
    this.users.set(me.id, me);
    await this.loadList({ _: "chatListMain" });
    await this.loadList({ _: "chatListArchive" });
    this.emit({
      type: "chats",
      chats: this.orderedChats(),
      nextCursor: null,
    });
  }

  async getCurrentUser(): Promise<CurrentUserDto> {
    const me = await this.client.invoke<Td.user>({ _: "getMe" });
    this.selfUserId = me.id;
    this.users.set(me.id, me);
    return {
      id: String(me.id),
      displayName: [me.first_name, me.last_name].filter(Boolean).join(" "),
      username: me.usernames?.active_usernames[0] ?? null,
      initials: initials(
        [me.first_name, me.last_name].filter(Boolean).join(" ") || "You",
      ),
      avatarDataUrl: null,
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
    this.chats.set(chatIdOf(chat.id), chat);
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
    const history = await this.client.invoke<Td.messages>({
      _: "getChatHistory",
      chat_id: Number(chatId),
      from_message_id: input.beforeMessageId
        ? Number(input.beforeMessageId)
        : 0,
      offset: 0,
      limit: input.limit ?? 50,
      only_local: false,
    });
    const historyMessages = history.messages.filter(
      (message): message is Td.message => message !== null,
    );
    const items = await Promise.all(
      [...historyMessages].reverse().map((message) => this.toMessage(message)),
    );
    const oldest = historyMessages.at(-1);
    return {
      items,
      nextCursor:
        historyMessages.length >= (input.limit ?? 50) && oldest
          ? messageIdOf(oldest.id)
          : null,
    };
  }

  async listSharedMedia(
    chatId: string,
    input: MessagePageInput,
  ): Promise<MessagePageDto> {
    const found = await this.client.invoke<Td.foundChatMessages>({
      _: "searchChatMessages",
      chat_id: Number(chatId),
      query: "",
      from_message_id: input.beforeMessageId
        ? Number(input.beforeMessageId)
        : 0,
      offset: 0,
      limit: input.limit ?? 50,
      filter: { _: "searchMessagesFilterPhotoAndVideo" },
    });
    const items = await Promise.all(
      [...found.messages].reverse().map((message) => this.toMessage(message)),
    );
    const oldest = found.messages.at(-1);
    return {
      items,
      nextCursor:
        found.messages.length >= (input.limit ?? 50) && oldest
          ? messageIdOf(oldest.id)
          : null,
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
    if (
      chat.type._ !== "chatTypeSupergroup" &&
      chat.type._ !== "chatTypeBasicGroup"
    ) {
      return [];
    }
    if (chat.type._ === "chatTypeSupergroup" && chat.type.is_channel) return [];
    const supergroupId =
      chat.type._ === "chatTypeSupergroup" ? chat.type.supergroup_id : null;
    if (!supergroupId) return [];
    const members = await this.client.invoke<Td.chatMembers>({
      _: "getSupergroupMembers",
      supergroup_id: supergroupId,
      offset: 0,
      limit: 50,
    });
    return members.members.flatMap((member) => {
      if (member.member_id._ !== "messageSenderUser") return [];
      const user = this.users.get(member.member_id.user_id);
      const name = user
        ? [user.first_name, user.last_name].filter(Boolean).join(" ")
        : String(member.member_id.user_id);
      return [
        {
          id: String(member.member_id.user_id),
          displayName: name,
          username: user?.usernames?.active_usernames[0] ?? null,
          avatarDataUrl: null,
        },
      ];
    });
  }

  async getPeerProfile(peerId: string): Promise<PeerProfileDto> {
    const user = await this.client
      .invoke<Td.user>({ _: "getUser", user_id: Number(peerId) })
      .catch(() => null);
    if (user) {
      this.users.set(user.id, user);
      const full = await this.client
        .invoke<Td.userFullInfo>({ _: "getUserFullInfo", user_id: user.id })
        .catch(() => null);
      return {
        id: String(user.id),
        title: [user.first_name, user.last_name].filter(Boolean).join(" "),
        username: user.usernames?.active_usernames[0] ?? null,
        kind: "direct",
        avatarDataUrl: null,
        bio: full?.bio?.text ?? null,
        phone: user.phone_number || null,
      };
    }
    const chat = this.chats.get(peerId);
    if (!chat) throw new Error(`Unknown peer ${peerId}`);
    return {
      id: peerId,
      title: chat.title,
      username: null,
      kind: this.toChat(chat).kind,
      avatarDataUrl: null,
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
      recent: recent.stickers.map(stickerItem),
      favorites: favorites.stickers.map(stickerItem),
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
    return result.stickers.map(stickerItem);
  }

  async sendSticker(chatId: string, stickerId: string): Promise<MessageDto> {
    const fileId = fileIdFromMediaId(stickerId);
    if (fileId === null) throw new Error("Sticker id is required");
    const message = await this.client.invoke<Td.message>({
      _: "sendMessage",
      chat_id: Number(chatId),
      input_message_content: {
        _: "inputMessageSticker",
        sticker: { _: "inputFileId", id: fileId },
        emoji: "",
        width: 0,
        height: 0,
      },
    });
    return this.toMessage(message);
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
      stickers: set.stickers.map(stickerItem),
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
    return stickers.stickers.map(stickerItem);
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
    const sendingId = this.sendingId;
    this.sendingId += 1;
    if (clientId) this.clientIds.set(String(sendingId), clientId);
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
    this.emit({
      type: "media-upload",
      uploadId,
      state: "uploading",
      progress: 0,
      error: null,
    });
    const contents = files.map((file, index) => ({
      _: "inputMessageDocument" as const,
      document: { _: "inputFileLocal" as const, path: file.source },
      caption:
        index === 0 && caption
          ? { _: "formattedText" as const, text: caption, entities: [] }
          : undefined,
    }));
    const replyTo = replyToId
      ? {
          _: "inputMessageReplyToMessage" as const,
          message_id: Number(replyToId),
        }
      : undefined;
    const sent =
      contents.length === 1
        ? [
            await this.client.invoke<Td.message>({
              _: "sendMessage",
              chat_id: Number(chatId),
              reply_to: replyTo,
              input_message_content: contents[0],
            }),
          ]
        : (
            await this.client.invoke<Td.messages>({
              _: "sendMessageAlbum",
              chat_id: Number(chatId),
              reply_to: replyTo,
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
        .map((message) => this.toMessage(message)),
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
    await this.client.invoke({
      _: "sendChatAction",
      chat_id: Number(chatId),
      action: typing ? { _: "chatActionTyping" } : { _: "chatActionCancel" },
    });
  }

  async saveDraft(chatId: string, text: string): Promise<void> {
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
    await this.client.invoke({
      _: "setMessageReactions",
      chat_id: Number(input.chatId),
      message_id: Number(input.messageId),
      reaction_types: input.emoji
        ? [{ _: "reactionTypeEmoji", emoji: input.emoji }]
        : [],
      is_big: false,
    });
  }

  async listAvailableReactions(chatId: string): Promise<ReadonlyArray<string>> {
    const chat = this.chats.get(chatId);
    const available = chat?.available_reactions;
    if (!available) return [];
    if (available._ === "chatAvailableReactionsAll") {
      return ["👍", "👎", "❤️", "🔥", "🎉", "😁"];
    }
    return available.reactions.flatMap((reaction) =>
      reaction._ === "reactionTypeEmoji" ? [reaction.emoji] : [],
    );
  }

  async logout(): Promise<void> {
    await this.client.invoke({ _: "logOut" });
    this.unsubscribe?.();
  }

  dispose(): void {
    this.unsubscribe?.();
  }

  private async handleUpdate(update: Td.Update): Promise<void> {
    if (update._ === "updateNewChat") {
      this.chats.set(chatIdOf(update.chat.id), update.chat);
      this.emit({ type: "chat-upsert", chat: this.toChat(update.chat) });
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
    if (update._ === "updateNewMessage") {
      const dto = await this.toMessage(update.message);
      this.emit({ type: "message-upsert", cause: "new", message: dto });
      return;
    }
    if (update._ === "updateMessageSendSucceeded") {
      const dto = await this.toMessage(update.message);
      const clientId = this.clientIds.get(String(update.old_message_id));
      this.emit({
        type: "message-upsert",
        cause: "new",
        message: clientId ? { ...dto, clientId } : dto,
      });
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
      this.users.set(update.user.id, update.user);
      return;
    }
    if (update._ === "updateChatAction") {
      if (update.action._ !== "chatActionTyping") return;
      const chat = this.chats.get(chatIdOf(update.chat_id));
      if (!chat) return;
      this.emit({
        type: "chat-upsert",
        chat: { ...this.toChat(chat), typing: true },
      });
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
    }
  }

  private async handleFile(file: Td.file): Promise<void> {
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
    for (const id of chats.chat_ids) {
      const chat = await this.client.invoke<Td.chat>({
        _: "getChat",
        chat_id: id,
      });
      this.chats.set(chatIdOf(chat.id), chat);
    }
  }

  private orderedChats(): ChatDto[] {
    return [...this.chats.values()]
      .map((chat) => this.toChat(chat))
      .sort((left, right) =>
        compareListOrder(left.listOrder ?? "0", right.listOrder ?? "0"),
      );
  }

  private folderDtos(): ReadonlyArray<ChatFolderDto> {
    return mapFolders(this.folders, this.orderedChats());
  }

  private toChat(chat: Td.chat): ChatDto {
    const mapped = mapChat(chat, {
      selfUserId: this.selfUserId,
      avatarUrl: () => null,
      avatarPending: () => false,
    });
    if (mapped.kind === "direct" && chat.type._ === "chatTypePrivate") {
      const user = this.users.get(chat.type.user_id);
      if (user?.status._ === "userStatusOnline") {
        return { ...mapped, presence: "online" };
      }
    }
    if (mapped.kind === "secret") {
      return { ...mapped, secretState: mapped.secretState ?? "ready" };
    }
    return mapped;
  }

  private async toMessage(message: Td.message): Promise<MessageDto> {
    const context: MessageMapContext = {
      selfUserId: this.selfUserId,
      avatarUrl: () => null,
      avatarPending: () => false,
      senderName: (sender) => this.senderName(sender),
      senderId: (sender) =>
        sender._ === "messageSenderUser"
          ? String(sender.user_id)
          : String(sender.chat_id),
    };
    const dto = mapMessage(message, context);
    this.indexKeyboard(dto, message);
    return dto;
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

  private indexKeyboard(dto: MessageDto, message: Td.message): void {
    const markup = message.reply_markup;
    if (!markup || markup._ !== "replyMarkupInlineKeyboard") return;
    markup.rows.forEach((row, rowIndex) => {
      row.forEach((button, columnIndex) => {
        if (button.type._ !== "inlineKeyboardButtonTypeCallback") return;
        this.callbackData.set(
          `${dto.chatId}:${dto.id}:${rowIndex}:${columnIndex}`,
          button.type.data,
        );
      });
    });
  }

  private emit(event: TelegramWorkspaceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
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
  sendSticker(chatId: string, stickerId: string): Promise<MessageDto> {
    return this.repository.sendSticker(chatId, stickerId);
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
  listAvailableReactions(chatId: string): Promise<ReadonlyArray<string>> {
    return this.repository.listAvailableReactions(chatId);
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
