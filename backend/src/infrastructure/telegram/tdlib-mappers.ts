import type * as Td from "tdlib-types";

import {
  ARCHIVE_FOLDER_ID,
  type AvatarPlaceholderDto,
  type ChatDto,
  type ChatFolderDto,
  type ChatKind,
  type MessageButtonDto,
  type MessageButtonKind,
  type MessageDto,
  type MessageEntityDto,
  type MessageFileMediaDto,
  type MessageForwardDto,
  type MessageKeyboardDto,
  type MessageMediaDto,
  type MessageReactionDto,
  type MessageReplyToDto,
  type MessageStickerDto,
  type StickerFormat,
  type StickerRole,
  type StickerSetReferenceDto,
} from "../../../../contracts/src/ipc";
import { isolatedEmojiCount } from "../../domain/telegram/isolated-emoji";

export interface ChatMapContext {
  readonly selfUserId: number | null;
  readonly avatarUrl: (peerId: string) => string | null;
  readonly avatarPending: (peerId: string) => boolean;
  readonly canSendMessages?: (chat: Td.chat) => boolean;
  readonly canSendStickers?: (chat: Td.chat) => boolean;
  readonly canSendMedia?: (chat: Td.chat) => boolean;
  readonly accentPalette?: AccentPaletteLookup;
  readonly avatarPlaceholder?: (peerId: string) => AvatarPlaceholderDto | null;
}

export interface MessageMapContext extends ChatMapContext {
  readonly senderName: (sender: Td.MessageSender) => string;
  readonly senderId: (sender: Td.MessageSender) => string;
  /** Chat `last_read_outbox_message_id`; outgoing ids at or below this are read. */
  readonly lastReadOutboxMessageId?: number;
}

/**
 * TDLib `updateAccentColors`: ids 0–6 are named theme colors the client
 * must supply; higher ids arrive as RGB lists. Gradients are two stops
 * matching Telegram Desktop `EmptyUserpic` / Android `AvatarDrawable`.
 */
export type AccentPaletteLookup = (accentColorId: number) => {
  light: ReadonlyArray<string>;
  dark: ReadonlyArray<string>;
};

const BUILT_IN_ACCENT: ReadonlyArray<{
  light: ReadonlyArray<string>;
  dark: ReadonlyArray<string>;
}> = [
  { light: ["#E17076", "#FF885E"], dark: ["#E17076", "#FF885E"] },
  { light: ["#FAA774", "#FFCD6A"], dark: ["#FAA774", "#FFCD6A"] },
  { light: ["#A695E7", "#BFA0F3"], dark: ["#A695E7", "#BFA0F3"] },
  { light: ["#7BC862", "#6EC96C"], dark: ["#7BC862", "#6EC96C"] },
  { light: ["#6EC9CB", "#53D4D4"], dark: ["#6EC9CB", "#53D4D4"] },
  { light: ["#65AADD", "#54B3F0"], dark: ["#65AADD", "#54B3F0"] },
  { light: ["#EE7AAE", "#F58FB7"], dark: ["#EE7AAE", "#F58FB7"] },
];

export function rgbToCss(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}

export function accentPaletteOf(
  accentColorId: number,
  custom: ReadonlyMap<number, Td.accentColor> = new Map(),
): { light: ReadonlyArray<string>; dark: ReadonlyArray<string> } {
  const extra = custom.get(accentColorId);
  if (extra) {
    return {
      light: extra.light_theme_colors.map(rgbToCss),
      dark: extra.dark_theme_colors.map(rgbToCss),
    };
  }
  if (accentColorId >= 0 && accentColorId <= 6) {
    return BUILT_IN_ACCENT[accentColorId]!;
  }
  return BUILT_IN_ACCENT[((accentColorId % 7) + 7) % 7]!;
}

/**
 * First grapheme of a peer title: one letter (uppercased) or an emoji,
 * matching Telegram's empty userpic, not two-letter initials.
 */
export function avatarGlyph(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  const first = [...segmenter.segment(trimmed)][0]?.segment;
  if (!first) return "?";
  if (/^\p{L}$/u.test(first)) return first.toUpperCase();
  return first;
}

export function mapAvatarPlaceholder(
  title: string,
  accentColorId: number,
  palette: AccentPaletteLookup = (id) => accentPaletteOf(id),
): AvatarPlaceholderDto {
  const colors = palette(accentColorId);
  return {
    glyph: avatarGlyph(title),
    lightColors: colors.light,
    darkColors: colors.dark,
  };
}

export function chatIdOf(id: number): string {
  return String(id);
}

/**
 * JPEG data URL for a TDLib minithumbnail. Profile and chat photos include
 * this even on min objects, so the renderer can paint a disc before
 * `downloadFile` finishes.
 */
export function minithumbnailDataUrl(mini?: Td.minithumbnail): string | null {
  if (!mini?.data) return null;
  return `data:image/jpeg;base64,${mini.data}`;
}

export function messageIdOf(id: number): string {
  return String(id);
}

export function mapAuthorizationStatus(
  state: Td.AuthorizationState,
): "idle" | "connecting" | "code-required" | "password-required" | "ready" {
  switch (state._) {
    case "authorizationStateWaitPhoneNumber":
    case "authorizationStateWaitTdlibParameters":
      return "idle";
    case "authorizationStateWaitCode":
      return "code-required";
    case "authorizationStateWaitPassword":
      return "password-required";
    case "authorizationStateReady":
      return "ready";
    case "authorizationStateWaitRegistration":
    case "authorizationStateWaitEmailAddress":
    case "authorizationStateWaitEmailCode":
    case "authorizationStateWaitOtherDeviceConfirmation":
    case "authorizationStateLoggingOut":
    case "authorizationStateClosing":
    case "authorizationStateClosed":
      return "idle";
    default:
      return "connecting";
  }
}

export function mapConnectionState(
  state: Td.ConnectionState,
): "offline" | "synchronizing" | "connected" {
  switch (state._) {
    case "connectionStateReady":
      return "connected";
    case "connectionStateUpdating":
    case "connectionStateConnecting":
    case "connectionStateConnectingToProxy":
    case "connectionStateWaitingForNetwork":
      return state._ === "connectionStateWaitingForNetwork"
        ? "offline"
        : "synchronizing";
    default:
      return "synchronizing";
  }
}

export function mapChatKind(
  chat: Td.chat,
  selfUserId: number | null,
): ChatKind {
  if (chat.type._ === "chatTypeSecret") return "secret";
  if (
    chat.type._ === "chatTypeBasicGroup" ||
    chat.type._ === "chatTypeSupergroup"
  ) {
    if (chat.type._ === "chatTypeSupergroup" && chat.type.is_channel) {
      return "channel";
    }
    return "group";
  }
  if (
    chat.type._ === "chatTypePrivate" &&
    selfUserId !== null &&
    chat.type.user_id === selfUserId
  ) {
    return "saved";
  }
  return "direct";
}

export function mapChat(chat: Td.chat, context: ChatMapContext): ChatDto {
  const position = primaryPosition(chat);
  const kind = mapChatKind(chat, context.selfUserId);
  const id = chatIdOf(chat.id);
  const avatarDataUrl = context.avatarUrl(id);
  const last = chat.last_message;
  return {
    id,
    title: chat.title,
    preview: last ? previewOf(last) : "",
    updatedAt: last
      ? new Date(last.date * 1000).toISOString()
      : new Date(0).toISOString(),
    unreadCount: chat.unread_count,
    lastReadMessageId: chat.last_read_inbox_message_id
      ? messageIdOf(chat.last_read_inbox_message_id)
      : null,
    muted: chat.notification_settings.mute_for > 0,
    pinned: position?.is_pinned ?? false,
    kind,
    canSendMessages: context.canSendMessages?.(chat) ?? true,
    canSendStickers: context.canSendStickers?.(chat) ?? true,
    canSendMedia: context.canSendMedia?.(chat) ?? true,
    initials: initials(chat.title),
    avatarDataUrl,
    avatarPending: context.avatarPending(id),
    avatarPlaceholder: mapAvatarPlaceholder(
      chat.title,
      chat.accent_color_id ?? 0,
      context.accentPalette,
    ),
    draftPreview: draftText(chat.draft_message),
    typing: false,
    folderId: folderIdOf(chat),
    listOrder: position?.order,
    secretState: kind === "secret" ? "ready" : undefined,
  };
}

export function compareListOrder(left: string, right: string): number {
  if (left.length !== right.length) return right.length - left.length;
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

export function mapFolders(
  folders: ReadonlyArray<Td.chatFolderInfo>,
  chats: ReadonlyArray<ChatDto>,
): ReadonlyArray<ChatFolderDto> {
  const archiveUnread = chats
    .filter((chat) => chat.folderId === ARCHIVE_FOLDER_ID)
    .reduce((sum, chat) => sum + chat.unreadCount, 0);
  const native = folders.map((folder) => ({
    id: folder.id,
    title: folder.name.text.text,
    unreadCount: chats
      .filter((chat) => chat.folderId === folder.id)
      .reduce((sum, chat) => sum + chat.unreadCount, 0),
  }));
  if (
    archiveUnread === 0 &&
    !chats.some((chat) => chat.folderId === ARCHIVE_FOLDER_ID)
  ) {
    return native;
  }
  return [
    {
      id: ARCHIVE_FOLDER_ID,
      title: "Archive",
      unreadCount: archiveUnread,
    },
    ...native,
  ];
}

export function mapMessage(
  message: Td.message,
  context: MessageMapContext,
): MessageDto {
  const text = formattedTextOf(message.content);
  // TDLib substitutes `messageAnimatedEmoji` for a text message whose whole
  // text is one emoji it has an animation for, so the emoji itself is no
  // longer in a `text` field. It is still the message's body: it is what a
  // reply quote, a chat-list preview and a notification have to say, and it
  // is the fallback the transcript draws until the document lands.
  const animatedEmoji =
    message.content._ === "messageAnimatedEmoji" ? message.content : null;
  const outgoing = message.is_outgoing;
  return {
    id: messageIdOf(message.id),
    chatId: chatIdOf(message.chat_id),
    senderName: outgoing ? "You" : context.senderName(message.sender_id),
    senderId: outgoing ? "" : context.senderId(message.sender_id),
    senderAvatarUrl: outgoing
      ? null
      : context.avatarUrl(context.senderId(message.sender_id)),
    senderAvatarPending: outgoing
      ? false
      : context.avatarPending(context.senderId(message.sender_id)),
    senderAvatarPlaceholder: outgoing
      ? null
      : (context.avatarPlaceholder?.(context.senderId(message.sender_id)) ??
        mapAvatarPlaceholder(
          context.senderName(message.sender_id),
          0,
          context.accentPalette,
        )),
    body: animatedEmoji ? animatedEmoji.emoji : (text?.text ?? ""),
    entities: text ? mapEntities(text) : [],
    // A message that carries formatting is not isolated emoji, whatever its
    // characters are: a link over a thumbs-up is a link.
    isolatedEmojiCount:
      text && text.entities.length === 0 ? isolatedEmojiCount(text.text) : 0,
    media: mapMedia(message),
    groupedId: message.media_album_id === "0" ? null : message.media_album_id,
    sentAt: new Date(message.date * 1000).toISOString(),
    outgoing,
    status: mapMessageStatus(message, context.lastReadOutboxMessageId),
    replyTo: mapReply(message, context),
    editedAt: message.edit_date
      ? new Date(message.edit_date * 1000).toISOString()
      : null,
    clientId:
      message.sending_state?._ === "messageSendingStatePending"
        ? String(message.sending_state.sending_id)
        : null,
    forwardedFrom: mapForward(message, context),
    keyboard: mapKeyboard(message.reply_markup),
    reactions: mapReactions(message.interaction_info),
  };
}

export function mapEntities(
  text: Td.formattedText,
): ReadonlyArray<MessageEntityDto> {
  return text.entities.flatMap((entity) => {
    const mapped = mapEntity(entity);
    return mapped ? [mapped] : [];
  });
}

export function mediaIdForFile(fileId: number): string {
  return `tdfile:${fileId}`;
}

export function fileIdFromMediaId(mediaId: string): number | null {
  if (!mediaId.startsWith("tdfile:")) return null;
  const id = Number(mediaId.slice("tdfile:".length));
  return Number.isInteger(id) ? id : null;
}

function mapEntity(entity: Td.textEntity): MessageEntityDto | null {
  const type = entity.type;
  const range = { offset: entity.offset, length: entity.length };
  switch (type._) {
    case "textEntityTypeBold":
      return { ...range, type: "bold" };
    case "textEntityTypeItalic":
      return { ...range, type: "italic" };
    case "textEntityTypeCode":
      return { ...range, type: "code" };
    case "textEntityTypeUnderline":
      return { ...range, type: "underline" };
    case "textEntityTypeStrikethrough":
      return { ...range, type: "strikethrough" };
    case "textEntityTypeSpoiler":
      return { ...range, type: "spoiler" };
    case "textEntityTypeMention":
      return { ...range, type: "mention" };
    case "textEntityTypeHashtag":
      return { ...range, type: "hashtag" };
    case "textEntityTypeBotCommand":
      return { ...range, type: "bot-command" };
    case "textEntityTypeUrl":
      return { ...range, type: "url" };
    case "textEntityTypeEmailAddress":
      return { ...range, type: "email" };
    case "textEntityTypePhoneNumber":
      return { ...range, type: "phone" };
    case "textEntityTypeCashtag":
      return { ...range, type: "cashtag" };
    case "textEntityTypePre":
    case "textEntityTypePreCode":
      return {
        ...range,
        type: "pre",
        language: type._ === "textEntityTypePreCode" ? type.language : "",
      };
    case "textEntityTypeTextUrl":
      return { ...range, type: "text-link", url: type.url };
    case "textEntityTypeMentionName":
      return { ...range, type: "text-mention", userId: String(type.user_id) };
    case "textEntityTypeCustomEmoji":
      return {
        ...range,
        type: "custom-emoji",
        documentId: type.custom_emoji_id,
      };
    case "textEntityTypeBlockQuote":
      return { ...range, type: "blockquote", collapsed: false };
    case "textEntityTypeExpandableBlockQuote":
      return { ...range, type: "blockquote", collapsed: true };
    default:
      return null;
  }
}

/**
 * One sticker document as message media. Both a sticker message and an
 * animated-emoji message land here; `role` is the only thing that separates
 * them, and it is what the transcript reads to decide the size and the
 * playback rule.
 */
export function stickerMedia(
  sticker: Td.sticker,
  role: StickerRole,
  emoji: string,
): MessageFileMediaDto & { readonly sticker: MessageStickerDto } {
  const format: StickerFormat =
    sticker.format._ === "stickerFormatTgs"
      ? "animated"
      : sticker.format._ === "stickerFormatWebm"
        ? "video"
        : "static";
  const setReference: StickerSetReferenceDto | null = sticker.set_id
    ? { kind: "id", id: sticker.set_id }
    : null;
  return {
    ...fileMedia({
      id: mediaIdForFile(sticker.sticker.id),
      kind: "sticker",
      mimeType:
        format === "animated"
          ? "application/x-tgsticker"
          : format === "video"
            ? "video/webm"
            : "image/webp",
      size: sticker.sticker.size,
      width: sticker.width,
      height: sticker.height,
    }),
    sticker: {
      emoji: emoji || null,
      role,
      format,
      setReference,
      outlinePath: null,
    },
  };
}

function mapMedia(message: Td.message): MessageMediaDto | null {
  const content = message.content;
  if (content._ === "messagePhoto" && content.photo.sizes.length > 0) {
    const size = largestPhotoSize(content.photo.sizes);
    return fileMedia({
      id: mediaIdForFile(size.photo.id),
      kind: "photo",
      width: size.width,
      height: size.height,
      size: size.photo.size,
      mimeType: "image/jpeg",
      spoiler: content.has_spoiler,
      blurredThumbnail: blurredThumbnail(content.photo.minithumbnail),
    });
  }
  if (content._ === "messageVideo") {
    return fileMedia({
      id: mediaIdForFile(content.video.video.id),
      kind: "video",
      fileName: content.video.file_name,
      mimeType: content.video.mime_type,
      size: content.video.video.size,
      width: content.video.width,
      height: content.video.height,
      duration: content.video.duration,
      spoiler: content.has_spoiler,
      blurredThumbnail: blurredThumbnail(content.video.minithumbnail),
    });
  }
  if (content._ === "messageAnimation") {
    return fileMedia({
      id: mediaIdForFile(content.animation.animation.id),
      kind: "animation",
      fileName: content.animation.file_name,
      mimeType: content.animation.mime_type,
      size: content.animation.animation.size,
      width: content.animation.width,
      height: content.animation.height,
      duration: content.animation.duration,
      spoiler: content.has_spoiler,
      blurredThumbnail: blurredThumbnail(content.animation.minithumbnail),
    });
  }
  if (content._ === "messageDocument") {
    return fileMedia({
      id: mediaIdForFile(content.document.document.id),
      kind: "file",
      fileName: content.document.file_name,
      mimeType: content.document.mime_type,
      size: content.document.document.size,
      blurredThumbnail: blurredThumbnail(content.document.minithumbnail),
    });
  }
  if (content._ === "messageAudio") {
    return fileMedia({
      id: mediaIdForFile(content.audio.audio.id),
      kind: "audio",
      fileName: content.audio.file_name,
      mimeType: content.audio.mime_type,
      size: content.audio.audio.size,
      duration: content.audio.duration,
    });
  }
  if (content._ === "messageVoiceNote") {
    return fileMedia({
      id: mediaIdForFile(content.voice_note.voice.id),
      kind: "voice",
      mimeType: content.voice_note.mime_type,
      size: content.voice_note.voice.size,
      duration: content.voice_note.duration,
    });
  }
  if (content._ === "messageVideoNote") {
    return fileMedia({
      id: mediaIdForFile(content.video_note.video.id),
      kind: "video-note",
      mimeType: "video/mp4",
      size: content.video_note.video.size,
      width: content.video_note.length,
      height: content.video_note.length,
      duration: content.video_note.duration,
      blurredThumbnail: blurredThumbnail(content.video_note.minithumbnail),
    });
  }
  if (content._ === "messageSticker") {
    return stickerMedia(content.sticker, "sticker", content.sticker.emoji);
  }
  if (content._ === "messageAnimatedEmoji") {
    const sticker = content.animated_emoji.sticker;
    // "May be null if yet unknown": TDLib promises an `updateMessageContent`
    // once it resolves, and gives the expected box meanwhile. Returning no
    // media here would draw the emoji as text and then reflow the row when
    // the document arrives, so the slot is reserved at the promised size and
    // the outline/skeleton stands in — the same contract every other sticker
    // has while it downloads.
    if (!sticker) return null;
    // The message's emoji names the document, not the sticker's own emoji:
    // for a custom animated emoji those differ, and what the reader typed is
    // the honest accessible name and text fallback.
    return stickerMedia(sticker, "emoji", content.emoji);
  }
  if (content._ === "messageText" && content.link_preview) {
    const preview = content.link_preview;
    const photo = photoFromLinkPreview(preview.type);
    const size =
      photo && photo.sizes.length > 0 ? largestPhotoSize(photo.sizes) : null;
    return {
      id: `webpage:${message.chat_id}:${message.id}`,
      kind: "webpage",
      url: preview.url,
      displayUrl: preview.display_url,
      siteName: preview.site_name,
      title: preview.title,
      description: preview.description.text,
      thumbnailMediaId: size ? mediaIdForFile(size.photo.id) : null,
    };
  }
  return null;
}

function fileMedia(
  fields: Partial<MessageFileMediaDto> &
    Pick<MessageFileMediaDto, "id" | "kind">,
): MessageFileMediaDto {
  return {
    fileName: null,
    mimeType: null,
    size: null,
    width: null,
    height: null,
    duration: null,
    spoiler: false,
    sticker: null,
    ...fields,
  };
}

function mapKeyboard(
  markup: Td.ReplyMarkup | undefined,
): MessageKeyboardDto | null {
  if (!markup || markup._ !== "replyMarkupInlineKeyboard") return null;
  return {
    rows: markup.rows.map((row, rowIndex) =>
      row.map((button, columnIndex) =>
        mapButton(button, rowIndex, columnIndex),
      ),
    ),
  };
}

function mapButton(
  button: Td.inlineKeyboardButton,
  row: number,
  column: number,
): MessageButtonDto {
  const kind: MessageButtonKind =
    button.type._ === "inlineKeyboardButtonTypeCallback"
      ? "callback"
      : button.type._ === "inlineKeyboardButtonTypeUrl"
        ? "url"
        : button.type._ === "inlineKeyboardButtonTypeCopyText"
          ? "copy"
          : "unsupported";
  return {
    id: `${row}:${column}`,
    text: button.text,
    kind,
    url:
      button.type._ === "inlineKeyboardButtonTypeUrl" ? button.type.url : null,
    copyText:
      button.type._ === "inlineKeyboardButtonTypeCopyText"
        ? button.type.text
        : null,
  };
}

/**
 * Telegram's reaction identity is the emoji without U+FE0F. A picker that
 * offers "❤️" while the wire uses "❤" looks chosen-wrong and
 * `addMessageReaction` rejects the variant as `REACTION_INVALID`. The
 * renderer puts the selector back only when painting
 * (`reactionEmojiForDisplay`).
 */
export function normalizeReactionEmoji(emoji: string): string {
  return emoji.replaceAll("\uFE0F", "");
}

function pushUniqueReactionEmoji(
  target: string[],
  seen: Set<string>,
  type: Td.ReactionType,
): void {
  if (type._ !== "reactionTypeEmoji") return;
  const emoji = normalizeReactionEmoji(type.emoji);
  if (!emoji || seen.has(emoji)) return;
  seen.add(emoji);
  target.push(emoji);
}

/**
 * Picker order matches Telegram Desktop: top, then recent, then popular,
 * dropping custom-emoji entries this client cannot render as chips.
 */
export function mapAvailableReactionEmojis(
  available: Td.availableReactions,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const emojis: string[] = [];
  for (const entry of [
    ...available.top_reactions,
    ...available.recent_reactions,
    ...available.popular_reactions,
  ]) {
    pushUniqueReactionEmoji(emojis, seen, entry.type);
  }
  return emojis;
}

export function mapReactionTypeEmojis(
  types: ReadonlyArray<Td.ReactionType>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const emojis: string[] = [];
  for (const type of types) pushUniqueReactionEmoji(emojis, seen, type);
  return emojis;
}

export function mapReactions(
  info: Td.messageInteractionInfo | undefined,
): ReadonlyArray<MessageReactionDto> | undefined {
  const reactions = info?.reactions?.reactions;
  if (!reactions || reactions.length === 0) return undefined;
  return reactions.flatMap((reaction) => {
    if (reaction.type._ !== "reactionTypeEmoji") return [];
    return [
      {
        emoji: normalizeReactionEmoji(reaction.type.emoji),
        count: reaction.total_count,
        chosen: reaction.is_chosen,
      },
    ];
  });
}

function mapForward(
  message: Td.message,
  context: MessageMapContext,
): MessageForwardDto | null {
  const origin = message.forward_info?.origin;
  if (!origin) return null;
  if (origin._ === "messageOriginUser") {
    return {
      senderName: context.senderName({
        _: "messageSenderUser",
        user_id: origin.sender_user_id,
      }),
      senderId: String(origin.sender_user_id),
      messageId: null,
    };
  }
  if (origin._ === "messageOriginChat") {
    return {
      senderName:
        origin.author_signature ||
        context.senderName({
          _: "messageSenderChat",
          chat_id: origin.sender_chat_id,
        }),
      senderId: String(origin.sender_chat_id),
      messageId: null,
    };
  }
  if (origin._ === "messageOriginChannel") {
    return {
      senderName:
        origin.author_signature ||
        context.senderName({
          _: "messageSenderChat",
          chat_id: origin.chat_id,
        }),
      senderId: String(origin.chat_id),
      messageId: messageIdOf(origin.message_id),
      postAuthor: origin.author_signature || null,
    };
  }
  if (origin._ === "messageOriginHiddenUser") {
    return {
      senderName: origin.sender_name,
      senderId: null,
      messageId: null,
    };
  }
  return null;
}

function mapReply(
  message: Td.message,
  context: MessageMapContext,
): MessageReplyToDto | null {
  const reply = message.reply_to;
  if (reply?._ !== "messageReplyToMessage" || !reply.message_id) return null;
  const quote = reply.quote?.text;
  const contentText = reply.content ? formattedTextOf(reply.content) : null;
  const body = quote?.text ?? contentText?.text ?? "";
  const entities = quote
    ? mapEntities(quote)
    : contentText
      ? mapEntities(contentText)
      : [];
  const senderName = reply.origin ? mapOriginName(reply.origin, context) : "";
  return {
    id: messageIdOf(reply.message_id),
    senderName,
    body,
    entities,
  };
}

function mapOriginName(
  origin: Td.MessageOrigin,
  context: MessageMapContext,
): string {
  if (origin._ === "messageOriginUser") {
    return context.senderName({
      _: "messageSenderUser",
      user_id: origin.sender_user_id,
    });
  }
  if (origin._ === "messageOriginChat") {
    return (
      origin.author_signature ||
      context.senderName({
        _: "messageSenderChat",
        chat_id: origin.sender_chat_id,
      })
    );
  }
  if (origin._ === "messageOriginChannel") {
    return (
      origin.author_signature ||
      context.senderName({
        _: "messageSenderChat",
        chat_id: origin.chat_id,
      })
    );
  }
  if (origin._ === "messageOriginHiddenUser") return origin.sender_name;
  return "";
}

function mapMessageStatus(
  message: Td.message,
  lastReadOutboxMessageId?: number,
): MessageDto["status"] {
  if (message.sending_state?._ === "messageSendingStateFailed") return "failed";
  if (message.sending_state?._ === "messageSendingStatePending")
    return "sending";
  if (
    message.is_outgoing &&
    lastReadOutboxMessageId !== undefined &&
    message.id <= lastReadOutboxMessageId
  ) {
    return "read";
  }
  return "sent";
}

function formattedTextOf(content: Td.MessageContent): Td.formattedText | null {
  if ("text" in content && content.text && typeof content.text === "object") {
    const text = content.text as Td.formattedText;
    if (text._ === "formattedText") return text;
  }
  if (
    "caption" in content &&
    content.caption &&
    typeof content.caption === "object"
  ) {
    const caption = content.caption as Td.formattedText;
    if (caption._ === "formattedText") return caption;
  }
  return null;
}

/**
 * Chat-list preview. Telegram Desktop shows the caption when one exists, and
 * otherwise a media kind label (`Photo`, `Sticker`, …).
 */
function previewOf(message: Td.message): string {
  const text = formattedTextOf(message.content)?.text.trim();
  if (text) return text;
  const content = message.content;
  if (content._ === "messagePhoto") return "Photo";
  if (content._ === "messageVideo") return "Video";
  if (content._ === "messageAnimation") return "GIF";
  if (content._ === "messageSticker") {
    return content.sticker.emoji || "Sticker";
  }
  if (content._ === "messageVoiceNote") return "Voice message";
  if (content._ === "messageVideoNote") return "Video message";
  if (content._ === "messageAudio") {
    return content.audio.file_name || "Audio";
  }
  if (content._ === "messageDocument") {
    return content.document.file_name || "File";
  }
  return "";
}

function largestPhotoSize(sizes: ReadonlyArray<Td.photoSize>): Td.photoSize {
  return sizes.reduce((best, size) =>
    size.width * size.height > best.width * best.height ? size : best,
  );
}

function blurredThumbnail(mini?: Td.minithumbnail): string | null {
  return minithumbnailDataUrl(mini);
}

function photoFromLinkPreview(type: Td.LinkPreviewType): Td.photo | undefined {
  if (type._ === "linkPreviewTypeAlbum") {
    const first = type.media[0];
    if (first?._ === "linkPreviewAlbumMediaPhoto") return first.photo;
    return undefined;
  }
  if ("photo" in type) {
    const photo = type.photo;
    if (photo && typeof photo === "object" && photo._ === "photo") {
      return photo;
    }
  }
  return undefined;
}

function draftText(draft: Td.draftMessage | undefined): string | null {
  if (!draft) return null;
  const content = draft.content;
  if (content._ === "draftMessageContentText") return content.text.text;
  return null;
}

function primaryPosition(chat: Td.chat): Td.chatPosition | undefined {
  return (
    chat.positions.find((position) => position.list._ === "chatListMain") ??
    chat.positions.find((position) => position.list._ === "chatListArchive") ??
    chat.positions[0]
  );
}

function folderIdOf(chat: Td.chat): number | null {
  if (
    chat.positions.some((position) => position.list._ === "chatListArchive")
  ) {
    return ARCHIVE_FOLDER_ID;
  }
  const folder = chat.positions.find(
    (position) => position.list._ === "chatListFolder",
  );
  if (folder && folder.list._ === "chatListFolder") {
    return folder.list.chat_folder_id;
  }
  return null;
}

export function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
}

export type { MessageReplyToDto };
