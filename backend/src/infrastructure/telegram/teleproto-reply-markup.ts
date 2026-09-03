import { Api } from "teleproto";

import type {
  BotCallbackAnswerDto,
  MessageButtonDto,
  MessageKeyboardDto,
} from "../../../../contracts/src/ipc";

/**
 * A mapped inline keyboard together with the callback payloads that keep it
 * pressable. Telegram's callback `data` is opaque bytes the bot authored and
 * expects back verbatim; it carries no meaning for the renderer and must not
 * reach web content, so it travels beside the DTO rather than inside it,
 * keyed by the very button ids the renderer presses.
 */
export interface MappedMessageKeyboard {
  readonly keyboard: MessageKeyboardDto;
  readonly callbackData: ReadonlyMap<string, Buffer>;
}

/**
 * Maps Telegram's `ReplyInlineMarkup` onto the transport keyboard. Buttons
 * this client cannot service are reported as `"unsupported"` instead of being
 * dropped: the keyboard is part of the message the bot sent, and a missing
 * button would misrepresent it (Telegram Desktop keeps such buttons too and
 * answers a press with an inform box, `api_bot.cpp:388-392`).
 *
 * Returns null for anything that is not an inline keyboard. The other
 * `ReplyMarkup` constructors — `ReplyKeyboardMarkup`, `ReplyKeyboardHide`,
 * `ReplyKeyboardForceReply` — are chat-level composer state shown above the
 * input, not a control strip under one bubble.
 */
export function mapReplyMarkup(
  markup: Api.TypeReplyMarkup | undefined,
): MappedMessageKeyboard | null {
  if (!(markup instanceof Api.ReplyInlineMarkup)) return null;
  const callbackData = new Map<string, Buffer>();
  const rows: Array<ReadonlyArray<MessageButtonDto>> = [];
  for (const row of markup.rows) {
    // A row without buttons would draw as a gap Telegram itself never shows;
    // Web K filters those before layout (`filterReplyMarkupRows.ts:3-5`).
    if (row.buttons.length === 0) continue;
    // Ids number the rows that survive, so they stay dense and address the
    // layout the renderer actually draws. They are positional and therefore
    // stable for as long as the message keeps this markup — which is exactly
    // as long as the callback payloads behind them stay valid.
    const rowIndex = rows.length;
    rows.push(
      row.buttons.map((button, column) =>
        mapButton(`${rowIndex}:${column}`, button, callbackData),
      ),
    );
  }
  // An inline markup whose every row was empty leaves nothing to draw, and a
  // keyboard with no rows is not a keyboard.
  if (rows.length === 0) return null;
  return { keyboard: { rows }, callbackData };
}

function mapButton(
  id: string,
  button: Api.TypeKeyboardInlineButton,
  callbackData: Map<string, Buffer>,
): MessageButtonDto {
  const type = button.type;
  if (type instanceof Api.InlineButtonTypeCallback) {
    callbackData.set(id, type.data);
    return { id, text: button.text, kind: "callback" };
  }
  if (type instanceof Api.InlineButtonTypeUrl) {
    return { id, text: button.text, kind: "url", url: type.url };
  }
  if (type instanceof Api.InlineButtonTypeCopy) {
    return { id, text: button.text, kind: "copy", copyText: type.copyText };
  }
  // Every remaining variant — switch-inline, web view, buy, game, url-auth,
  // user profile, disabled, and whatever a future layer adds — needs a
  // capability this client does not have. It still occupies its slot.
  return { id, text: button.text, kind: "unsupported" };
}

/**
 * Maps `messages.botCallbackAnswer` with Telegram's own precedence, which
 * both reference clients apply identically (`api_bot.cpp:118-152`): a
 * non-empty message wins over a url, `alert` decides between a modal and a
 * toast, and only an answer carrying neither is silent. `cache_time` is
 * ignored — neither reference client caches answers either.
 */
export function mapBotCallbackAnswer(
  answer: Api.messages.TypeBotCallbackAnswer,
): BotCallbackAnswerDto {
  const text = answer.message ?? "";
  if (text) return { kind: "message", text, alert: Boolean(answer.alert) };
  const url = answer.url ?? "";
  if (url) return { kind: "url", url };
  return { kind: "none" };
}
