import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type * as Td from "tdlib-types";

import {
  accentPaletteOf,
  avatarGlyph,
  chatIdOf,
  compareListOrder,
  fileIdFromMediaId,
  initials,
  mapAuthorizationStatus,
  mapAvailableReactionEmojis,
  mapAvatarPlaceholder,
  mapChat,
  mapChatKind,
  mapConnectionState,
  mapFolders,
  mapMessage,
  mapMessageCall,
  mapMessagePoll,
  mapReactionTypeEmojis,
  mediaIdForFile,
  minithumbnailDataUrl,
  normalizeReactionEmoji,
} from "./tdlib-mappers";

const goldenRoot = path.dirname(fileURLToPath(import.meta.url));

function loadGolden<T>(name: string): T {
  return JSON.parse(
    readFileSync(path.join(goldenRoot, "goldens", name), "utf8"),
  ) as T;
}

const emptyContext = {
  selfUserId: 1,
  avatarUrl: () => null,
  avatarPending: () => false,
};

function chat(partial: Record<string, unknown>): Td.chat {
  return {
    _: "chat",
    id: 11,
    type: { _: "chatTypePrivate", user_id: 11 },
    title: "Ada",
    unread_count: 0,
    last_read_inbox_message_id: 0,
    last_read_outbox_message_id: 0,
    unread_mention_count: 0,
    unread_reaction_count: 0,
    notification_settings: { _: "chatNotificationSettings", mute_for: 0 },
    positions: [
      {
        _: "chatPosition",
        list: { _: "chatListMain" },
        order: "100",
        is_pinned: false,
      },
    ],
    ...partial,
  } as unknown as Td.chat;
}

describe("tdlib mappers", () => {
  it("maps authorization and connection states", () => {
    expect(
      mapAuthorizationStatus({ _: "authorizationStateWaitPhoneNumber" }),
    ).toBe("idle");
    expect(
      mapAuthorizationStatus({
        _: "authorizationStateWaitCode",
      } as Td.AuthorizationState),
    ).toBe("code-required");
    expect(
      mapAuthorizationStatus({
        _: "authorizationStateWaitPassword",
        password_hint: "hint",
        has_recovery_email_address: false,
        has_passport_data: false,
      } as Td.AuthorizationState),
    ).toBe("password-required");
    expect(mapAuthorizationStatus({ _: "authorizationStateReady" })).toBe(
      "ready",
    );
    expect(
      mapAuthorizationStatus({ _: "authorizationStateWaitTdlibParameters" }),
    ).toBe("idle");
    expect(mapConnectionState({ _: "connectionStateReady" })).toBe("connected");
    expect(mapConnectionState({ _: "connectionStateUpdating" })).toBe(
      "synchronizing",
    );
    expect(mapConnectionState({ _: "connectionStateWaitingForNetwork" })).toBe(
      "offline",
    );
  });

  it("maps chat kinds including secret and saved", () => {
    expect(
      mapChatKind(
        chat({ type: { _: "chatTypeSecret", user_id: 2, secret_chat_id: 9 } }),
        1,
      ),
    ).toBe("secret");
    expect(
      mapChatKind(
        chat({
          type: { _: "chatTypeSupergroup", supergroup_id: 3, is_channel: true },
        }),
        1,
      ),
    ).toBe("channel");
    expect(
      mapChatKind(
        chat({
          type: {
            _: "chatTypeSupergroup",
            supergroup_id: 3,
            is_channel: false,
          },
        }),
        1,
      ),
    ).toBe("group");
    expect(
      mapChatKind(chat({ type: { _: "chatTypePrivate", user_id: 1 } }), 1),
    ).toBe("saved");
    expect(
      mapChatKind(chat({ type: { _: "chatTypePrivate", user_id: 11 } }), 1),
    ).toBe("direct");
  });

  it("maps chats with list order, mute, pin, and archive folder", () => {
    const mapped = mapChat(
      chat({
        unread_count: 3,
        last_read_inbox_message_id: 9,
        notification_settings: { _: "chatNotificationSettings", mute_for: 60 },
        positions: [
          {
            _: "chatPosition",
            list: { _: "chatListArchive" },
            order: "200",
            is_pinned: true,
          },
        ],
        last_message: {
          _: "message",
          date: 1700000000,
          content: {
            _: "messageText",
            text: { _: "formattedText", text: "Hi", entities: [] },
          },
        },
        draft_message: {
          _: "draftMessage",
          content: {
            _: "draftMessageContentText",
            text: { _: "formattedText", text: "draft", entities: [] },
          },
        },
      }),
      emptyContext,
    );
    expect(mapped).toMatchObject({
      id: "11",
      title: "Ada",
      preview: "Hi",
      unreadCount: 3,
      lastReadMessageId: "9",
      muted: true,
      pinned: true,
      kind: "direct",
      draftPreview: "draft",
      folderId: 1,
      listOrder: "200",
      avatarPlaceholder: {
        glyph: "A",
        lightColors: ["#E17076", "#FF885E"],
        darkColors: ["#E17076", "#FF885E"],
      },
    });
  });

  it("maps canSendMessages from the chat context", () => {
    expect(mapChat(chat({}), emptyContext).canSendMessages).toBe(true);
    expect(
      mapChat(chat({}), {
        ...emptyContext,
        canSendMessages: () => false,
      }).canSendMessages,
    ).toBe(false);
  });

  it("maps sticker and media send flags from the chat context", () => {
    const mapped = mapChat(chat({}), {
      ...emptyContext,
      canSendStickers: () => false,
      canSendMedia: () => false,
    });
    expect(mapped.canSendMessages).toBe(true);
    expect(mapped.canSendStickers).toBe(false);
    expect(mapped.canSendMedia).toBe(false);
  });

  it("sorts TDLib list-order strings highest first", () => {
    expect(compareListOrder("9", "10")).toBeGreaterThan(0);
    expect(compareListOrder("100", "20")).toBeLessThan(0);
    expect(compareListOrder("5", "5")).toBe(0);
  });

  it("maps folders and injects Archive when chats sit there", () => {
    const chats = [
      mapChat(
        chat({
          positions: [
            {
              _: "chatPosition",
              list: { _: "chatListArchive" },
              order: "1",
              is_pinned: false,
            },
          ],
          unread_count: 2,
        }),
        emptyContext,
      ),
    ];
    expect(
      mapFolders(
        [
          {
            _: "chatFolderInfo",
            id: 2,
            name: {
              _: "chatFolderName",
              text: { _: "formattedText", text: "Work", entities: [] },
            },
          } as unknown as Td.chatFolderInfo,
        ],
        chats,
      ),
    ).toEqual([
      { id: 1, title: "Archive", unreadCount: 2 },
      { id: 2, title: "Work", unreadCount: 0 },
    ]);
  });

  it("maps a checked-in td_api message JSON onto MessageDto", () => {
    const message = loadGolden<Td.message>("message-text.json");
    const mapped = mapMessage(message, {
      ...emptyContext,
      senderName: () => "Mina",
      senderId: () => "7",
      avatarPlaceholder: () => mapAvatarPlaceholder("Mina", 2),
    });
    expect(mapped).toMatchObject({
      id: "42",
      chatId: "11",
      senderName: "Mina",
      senderId: "7",
      senderAvatarPlaceholder: {
        glyph: "M",
        lightColors: ["#A695E7", "#BFA0F3"],
        darkColors: ["#A695E7", "#BFA0F3"],
      },
      body: "Hello **Ada**",
      entities: [{ offset: 6, length: 5, type: "bold" }],
      outgoing: false,
      reactions: [{ emoji: "👍", count: 2, chosen: true }],
    });
  });

  it("derives an empty userpic from the sender name when the peer is unknown", () => {
    const message = loadGolden<Td.message>("message-text.json");
    const mapped = mapMessage(message, {
      ...emptyContext,
      senderName: () => "boldcheck",
      senderId: () => "99",
    });
    expect(mapped.senderAvatarPlaceholder).toEqual({
      glyph: "B",
      lightColors: ["#E17076", "#FF885E"],
      darkColors: ["#E17076", "#FF885E"],
    });
  });

  it("maps media kinds and file ids", () => {
    expect(mediaIdForFile(8)).toBe("tdfile:8");
    expect(fileIdFromMediaId("tdfile:8")).toBe(8);
    expect(fileIdFromMediaId("other")).toBeNull();
    expect(chatIdOf(11)).toBe("11");
    expect(initials("Ada Byron")).toBe("AB");
    expect(initials("Ada")).toBe("AD");
    expect(initials("")).toBe("?");
    expect(avatarGlyph("Ada Byron")).toBe("A");
    expect(avatarGlyph("test")).toBe("T");
    expect(avatarGlyph("风向旗参考快讯")).toBe("风");
    expect(avatarGlyph("🔥 HN")).toBe("🔥");
    expect(avatarGlyph("")).toBe("?");
    expect(mapAvatarPlaceholder("test", 3)).toEqual({
      glyph: "T",
      lightColors: ["#7BC862", "#6EC96C"],
      darkColors: ["#7BC862", "#6EC96C"],
    });
    expect(accentPaletteOf(0).light[0]).toBe("#E17076");
    expect(
      accentPaletteOf(
        42,
        new Map([
          [
            42,
            {
              _: "accentColor",
              id: 42,
              built_in_accent_color_id: 0,
              light_theme_colors: [0xe91e63],
              dark_theme_colors: [0x880e4f],
              min_channel_chat_boost_level: 0,
            } as Td.accentColor,
          ],
        ]),
      ),
    ).toEqual({
      light: ["#e91e63"],
      dark: ["#880e4f"],
    });

    const photo = mapMessage(
      {
        _: "message",
        id: 1,
        chat_id: 11,
        is_outgoing: true,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        content: {
          _: "messagePhoto",
          photo: {
            sizes: [{ width: 10, height: 10, photo: { id: 8, size: 12 } }],
          },
          has_spoiler: true,
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "", senderId: () => "" },
    );
    expect(photo.media).toMatchObject({
      id: "tdfile:8",
      kind: "photo",
      spoiler: true,
    });

    const sticker = mapMessage(
      {
        _: "message",
        id: 2,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        sender_id: { _: "messageSenderUser", user_id: 7 },
        content: {
          _: "messageSticker",
          sticker: {
            emoji: "🐙",
            width: 512,
            height: 512,
            set_id: "9",
            format: { _: "stickerFormatWebp" },
            sticker: { id: 3, size: 10 },
          },
        },
      } as unknown as Td.message,
      {
        ...emptyContext,
        senderName: () => "Mina",
        senderId: () => "7",
      },
    );
    expect(sticker.media).toMatchObject({
      kind: "sticker",
      sticker: {
        emoji: "🐙",
        format: "static",
        setReference: { kind: "id", id: "9" },
      },
    });
  });

  it("maps an animated emoji to sticker media that keeps its emoji as the body", () => {
    const message = mapMessage(
      {
        _: "message",
        id: 4,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        sender_id: { _: "messageSenderUser", user_id: 7 },
        content: {
          _: "messageAnimatedEmoji",
          emoji: "🎉",
          animated_emoji: {
            _: "animatedEmoji",
            sticker_width: 512,
            sticker_height: 512,
            fitzpatrick_type: 0,
            sticker: {
              emoji: "🎉",
              width: 512,
              height: 512,
              set_id: "0",
              format: { _: "stickerFormatTgs" },
              sticker: { id: 5, size: 10 },
            },
          },
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "Mina", senderId: () => "7" },
    );

    // TDLib takes the emoji out of the text when it substitutes this content
    // type, but a reply quote, a chat-list preview and a notification all
    // still have to say something, so the body keeps it.
    expect(message.body).toBe("🎉");
    expect(message.media).toMatchObject({
      kind: "sticker",
      sticker: { emoji: "🎉", role: "emoji", format: "animated" },
    });
    // It is the message, not an emoji-only text message on top of it.
    expect(message.isolatedEmojiCount).toBe(0);
  });

  it("leaves an animated emoji without a resolved document as text", () => {
    const message = mapMessage(
      {
        _: "message",
        id: 5,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        sender_id: { _: "messageSenderUser", user_id: 7 },
        content: {
          _: "messageAnimatedEmoji",
          emoji: "🎉",
          animated_emoji: {
            _: "animatedEmoji",
            sticker_width: 512,
            sticker_height: 512,
            fitzpatrick_type: 0,
          },
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "Mina", senderId: () => "7" },
    );

    // "May be null if yet unknown". TDLib follows with updateMessageContent
    // once it resolves; until then the emoji is all there is to draw.
    expect(message.body).toBe("🎉");
    expect(message.media).toBeNull();
  });

  it("counts emoji-only text so the transcript can draw it large", () => {
    const isolated = (text: string, entities: unknown[] = []) =>
      mapMessage(
        {
          _: "message",
          id: 6,
          chat_id: 11,
          is_outgoing: false,
          date: 1,
          edit_date: 0,
          media_album_id: "0",
          sender_id: { _: "messageSenderUser", user_id: 7 },
          content: {
            _: "messageText",
            text: { _: "formattedText", text, entities },
          },
        } as unknown as Td.message,
        { ...emptyContext, senderName: () => "Mina", senderId: () => "7" },
      ).isolatedEmojiCount;

    expect(isolated("🚀🌘")).toBe(2);
    expect(isolated("ship it 🚀")).toBe(0);
    // Formatting means the message is more than its characters.
    expect(
      isolated("🚀", [
        {
          _: "textEntity",
          offset: 0,
          length: 2,
          type: { _: "textEntityTypeTextUrl", url: "https://example.com" },
        },
      ]),
    ).toBe(0);
  });

  it("maps reply quotes, stripped thumbnails, webpage photos, and read receipts", () => {
    const reply = mapMessage(
      {
        _: "message",
        id: 3,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        reply_to: {
          _: "messageReplyToMessage",
          chat_id: 11,
          message_id: 2,
          quote: {
            text: { _: "formattedText", text: "quoted", entities: [] },
          },
        },
        content: {
          _: "messageText",
          text: { _: "formattedText", text: "ok", entities: [] },
        },
      } as unknown as Td.message,
      {
        ...emptyContext,
        senderName: () => "Mina",
        senderId: () => "7",
      },
    );
    expect(reply.replyTo).toEqual({
      id: "2",
      senderName: "",
      body: "quoted",
      entities: [],
    });

    const photo = mapMessage(
      {
        _: "message",
        id: 4,
        chat_id: 11,
        is_outgoing: true,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        content: {
          _: "messagePhoto",
          photo: {
            minithumbnail: {
              _: "minithumbnail",
              data: "abcd",
              width: 8,
              height: 8,
            },
            sizes: [{ width: 10, height: 10, photo: { id: 8, size: 12 } }],
          },
          has_spoiler: false,
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "", senderId: () => "" },
    );
    expect(photo.media).toMatchObject({
      kind: "photo",
      blurredThumbnail: "data:image/jpeg;base64,abcd",
    });

    const webpage = mapMessage(
      {
        _: "message",
        id: 5,
        chat_id: 11,
        is_outgoing: false,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        content: {
          _: "messageText",
          text: { _: "formattedText", text: "https://telo.dev", entities: [] },
          link_preview: {
            url: "https://telo.dev",
            display_url: "telo.dev",
            site_name: "Telo",
            title: "Telo",
            description: { _: "formattedText", text: "Client", entities: [] },
            type: {
              _: "linkPreviewTypeArticle",
              photo: {
                _: "photo",
                sizes: [{ width: 20, height: 10, photo: { id: 9, size: 4 } }],
              },
            },
          },
        },
      } as unknown as Td.message,
      { ...emptyContext, senderName: () => "Mina", senderId: () => "7" },
    );
    expect(webpage.media).toMatchObject({
      kind: "webpage",
      thumbnailMediaId: "tdfile:9",
    });

    const read = mapMessage(
      {
        _: "message",
        id: 6,
        chat_id: 11,
        is_outgoing: true,
        date: 1,
        edit_date: 0,
        media_album_id: "0",
        content: {
          _: "messageText",
          text: { _: "formattedText", text: "hi", entities: [] },
        },
      } as unknown as Td.message,
      {
        ...emptyContext,
        senderName: () => "",
        senderId: () => "",
        lastReadOutboxMessageId: 6,
      },
    );
    expect(read.status).toBe("read");
  });

  it("uses Telegram Desktop media labels for caption-less chat previews", () => {
    const mapped = mapChat(
      chat({
        last_message: {
          _: "message",
          date: 1700000000,
          content: { _: "messagePhoto", photo: { sizes: [] } },
        },
      }),
      emptyContext,
    );
    expect(mapped.preview).toBe("Photo");
  });

  it("turns a TDLib minithumbnail into a JPEG data URL", () => {
    expect(
      minithumbnailDataUrl({
        _: "minithumbnail",
        width: 8,
        height: 8,
        data: "YQ==",
      }),
    ).toBe("data:image/jpeg;base64,YQ==");
    expect(minithumbnailDataUrl(undefined)).toBeNull();
  });

  it("strips emoji variation selectors so reactions match Telegram's wire form", () => {
    expect(normalizeReactionEmoji("❤️")).toBe("❤");
    expect(normalizeReactionEmoji("👍")).toBe("👍");
  });

  it("orders message reactions as top, then recent, then popular, unique", () => {
    expect(
      mapAvailableReactionEmojis({
        _: "availableReactions",
        top_reactions: [
          {
            _: "availableReaction",
            type: { _: "reactionTypeEmoji", emoji: "❤️" },
            needs_premium: false,
          },
        ],
        recent_reactions: [
          {
            _: "availableReaction",
            type: { _: "reactionTypeEmoji", emoji: "🔥" },
            needs_premium: false,
          },
        ],
        popular_reactions: [
          {
            _: "availableReaction",
            type: { _: "reactionTypeEmoji", emoji: "❤" },
            needs_premium: false,
          },
          {
            _: "availableReaction",
            type: { _: "reactionTypeEmoji", emoji: "🎉" },
            needs_premium: false,
          },
        ],
        allow_custom_emoji: false,
        are_tags: false,
      }),
    ).toEqual(["❤", "🔥", "🎉"]);
  });

  it("maps a chat's restricted reaction types without inventing extras", () => {
    expect(
      mapReactionTypeEmojis([
        { _: "reactionTypeEmoji", emoji: "👍" },
        { _: "reactionTypeCustomEmoji", custom_emoji_id: "1" },
        { _: "reactionTypeEmoji", emoji: "👍" },
      ]),
    ).toEqual(["👍"]);
  });

  it("maps call log entries the way tdesktop's MediaCall::Text folds them", () => {
    const call = (
      isOutgoing: boolean,
      discardReason: string,
      duration: number,
      isVideo = false,
    ) =>
      mapMessageCall(
        {
          _: "messageCall",
          unique_id: "1",
          is_video: isVideo,
          discard_reason: { _: discardReason },
          duration,
        } as unknown as Td.MessageContent,
        isOutgoing,
      );

    // Connected calls keep their duration and direction.
    expect(call(true, "callDiscardReasonEmpty", 65)).toEqual({
      video: false,
      status: "outgoing",
      durationSeconds: 65,
    });
    expect(call(false, "callDiscardReasonEmpty", 12, true)).toEqual({
      video: true,
      status: "incoming",
      durationSeconds: 12,
    });
    // Missed/declined calls force the duration to 0: the call never
    // connected, whatever TDLib stored.
    expect(call(false, "callDiscardReasonMissed", 30)).toEqual({
      video: false,
      status: "missed",
      durationSeconds: 0,
    });
    expect(call(true, "callDiscardReasonMissed", 30)).toEqual({
      video: false,
      status: "cancelled",
      durationSeconds: 0,
    });
    expect(call(false, "callDiscardReasonDeclined", 30)).toEqual({
      video: false,
      status: "declined",
      durationSeconds: 0,
    });
    // An outgoing decline still reads as an outgoing call, duration 0.
    expect(call(true, "callDiscardReasonDeclined", 30)).toEqual({
      video: false,
      status: "outgoing",
      durationSeconds: 0,
    });

    expect(
      mapMessageCall(
        {
          _: "messageGroupCall",
          unique_id: "7",
          is_active: true,
          was_missed: false,
          is_video: false,
          duration: 90,
          other_participant_ids: [],
        } as unknown as Td.MessageContent,
        false,
      ),
    ).toEqual({
      video: false,
      status: "group",
      active: true,
      durationSeconds: 90,
    });

    expect(
      mapMessageCall(
        {
          _: "messageText",
          text: { _: "formattedText", text: "hi", entities: [] },
        } as unknown as Td.MessageContent,
        true,
      ),
    ).toBeNull();
  });

  it("maps a poll message, hiding the quiz answer until it is known", () => {
    const pollContent = (
      type: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) =>
      ({
        _: "messagePoll",
        poll: {
          _: "poll",
          id: "p1",
          question: { _: "formattedText", text: "Pick one", entities: [] },
          options: [
            {
              _: "pollOption",
              id: "a",
              text: { _: "formattedText", text: "First", entities: [] },
              voter_count: 2,
              vote_percentage: 67,
              is_chosen: true,
              is_being_chosen: false,
              recent_voter_ids: [],
              addition_date: 0,
            },
            {
              _: "pollOption",
              id: "b",
              text: { _: "formattedText", text: "Second", entities: [] },
              voter_count: 1,
              vote_percentage: 33,
              is_chosen: false,
              is_being_chosen: false,
              recent_voter_ids: [],
              addition_date: 0,
            },
          ],
          total_voter_count: 3,
          recent_voter_ids: [],
          can_get_voters: false,
          can_see_results: true,
          is_anonymous: true,
          allows_multiple_answers: true,
          allows_revoting: false,
          members_only: false,
          country_codes: [],
          option_order: [],
          type,
          open_period: 0,
          close_date: 0,
          is_closed: false,
          ...extra,
        },
      }) as unknown as Td.MessageContent;

    // A regular poll keeps its flags and per-option tallies.
    expect(mapMessagePoll(pollContent({ _: "pollTypeRegular" }))).toEqual({
      id: "p1",
      question: "Pick one",
      options: [
        {
          id: "a",
          text: "First",
          voterCount: 2,
          votePercentage: 67,
          chosen: true,
        },
        {
          id: "b",
          text: "Second",
          voterCount: 1,
          votePercentage: 33,
          chosen: false,
        },
      ],
      totalVoterCount: 3,
      isAnonymous: true,
      isClosed: false,
      kind: "regular",
      allowMultipleAnswers: true,
      correctOptionIds: null,
    });

    // An unanswered quiz ships empty correct_option_ids — the DTO hides
    // them (tdesktop's reveal rule), and multiple answers are always off.
    expect(
      mapMessagePoll(
        pollContent({
          _: "pollTypeQuiz",
          correct_option_ids: [],
          explanation: { _: "formattedText", text: "", entities: [] },
        }),
      ),
    ).toMatchObject({
      kind: "quiz",
      allowMultipleAnswers: false,
      correctOptionIds: null,
    });

    // Once answered, TDLib fills correct_option_ids and the DTO reveals them.
    expect(
      mapMessagePoll(
        pollContent({
          _: "pollTypeQuiz",
          correct_option_ids: [1],
          explanation: { _: "formattedText", text: "", entities: [] },
        }),
      ),
    ).toMatchObject({ kind: "quiz", correctOptionIds: [1] });

    // Non-poll content maps to null.
    expect(
      mapMessagePoll({
        _: "messageText",
        text: { _: "formattedText", text: "hi", entities: [] },
      } as unknown as Td.MessageContent),
    ).toBeNull();
  });

  it("previews a poll in the chat list by its question", () => {
    const mapped = mapChat(
      chat({
        last_message: {
          _: "message",
          id: 5,
          chat_id: 11,
          date: 1700000000,
          is_outgoing: false,
          sender_id: { _: "messageSenderUser", user_id: 1 },
          content: {
            _: "messagePoll",
            poll: {
              _: "poll",
              id: "p1",
              question: {
                _: "formattedText",
                text: "Lunch where?",
                entities: [],
              },
              options: [],
              total_voter_count: 0,
              recent_voter_ids: [],
              can_get_voters: false,
              can_see_results: false,
              is_anonymous: true,
              allows_multiple_answers: false,
              allows_revoting: false,
              members_only: false,
              country_codes: [],
              option_order: [],
              type: { _: "pollTypeRegular" },
              open_period: 0,
              close_date: 0,
              is_closed: false,
            },
          },
        },
      }),
      emptyContext,
    );
    expect(mapped.preview).toBe("Poll: Lunch where?");
  });
});
