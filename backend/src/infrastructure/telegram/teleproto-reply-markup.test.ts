import { Api, helpers } from "teleproto";
import { describe, expect, it } from "vitest";

import { mapBotCallbackAnswer, mapReplyMarkup } from "./teleproto-reply-markup";

function row(
  ...buttons: ReadonlyArray<Api.KeyboardInlineButton>
): Api.KeyboardInlineButtonRow {
  return new Api.KeyboardInlineButtonRow({ buttons: [...buttons] });
}

function button(
  text: string,
  type: Api.TypeInlineButtonType,
): Api.KeyboardInlineButton {
  return new Api.KeyboardInlineButton({ text, type });
}

function callback(text: string, data: string): Api.KeyboardInlineButton {
  return button(
    text,
    new Api.InlineButtonTypeCallback({ data: Buffer.from(data) }),
  );
}

describe("mapReplyMarkup", () => {
  it("maps the three actionable button kinds and keeps callback data out of the dto", () => {
    const mapped = mapReplyMarkup(
      new Api.ReplyInlineMarkup({
        rows: [
          row(
            callback("Vote", "vote:1"),
            button(
              "Docs",
              new Api.InlineButtonTypeUrl({ url: "https://t.me" }),
            ),
          ),
          row(
            button(
              "Copy code",
              new Api.InlineButtonTypeCopy({ copyText: "TELO-42" }),
            ),
          ),
        ],
      }),
    );

    expect(mapped?.keyboard).toEqual({
      rows: [
        [
          { id: "0:0", text: "Vote", kind: "callback" },
          { id: "0:1", text: "Docs", kind: "url", url: "https://t.me" },
        ],
        [{ id: "1:0", text: "Copy code", kind: "copy", copyText: "TELO-42" }],
      ],
    });
    // The opaque bytes travel beside the keyboard, never inside it.
    expect([...(mapped?.callbackData ?? [])]).toEqual([
      ["0:0", Buffer.from("vote:1")],
    ]);
  });

  it("reports every button it cannot service instead of dropping it", () => {
    const unsupported: ReadonlyArray<Api.TypeInlineButtonType> = [
      new Api.InlineButtonTypeSwitchInline({ query: "q" }),
      new Api.InlineButtonTypeWebView({ url: "https://app.example" }),
      new Api.InlineButtonTypeBuy(),
      new Api.InlineButtonTypeGame(),
      new Api.InlineButtonTypeUrlAuth({ url: "https://auth", buttonId: 1 }),
      new Api.InlineButtonTypeUserProfile({
        userId: helpers.returnBigInt(7),
      }),
      new Api.InlineButtonTypeDisabled(),
    ];

    const mapped = mapReplyMarkup(
      new Api.ReplyInlineMarkup({
        rows: unsupported.map((type, index) => row(button(`b${index}`, type))),
      }),
    );

    expect(mapped?.keyboard.rows.flat()).toEqual(
      unsupported.map((_type, index) => ({
        id: `${index}:0`,
        text: `b${index}`,
        kind: "unsupported",
      })),
    );
    expect(mapped?.callbackData.size).toBe(0);
  });

  it("drops empty rows and numbers the surviving ones densely", () => {
    const mapped = mapReplyMarkup(
      new Api.ReplyInlineMarkup({
        rows: [
          row(),
          row(callback("First", "a")),
          row(),
          row(callback("Second", "b"), callback("Third", "c")),
        ],
      }),
    );

    expect(
      mapped?.keyboard.rows.map((entry) => entry.map((b) => b.id)),
    ).toEqual([["0:0"], ["1:0", "1:1"]]);
    // Payload keys follow the same dense numbering, so a press resolves.
    expect([...(mapped?.callbackData.keys() ?? [])]).toEqual([
      "0:0",
      "1:0",
      "1:1",
    ]);
  });

  it("has no keyboard for a markup that draws nothing", () => {
    expect(
      mapReplyMarkup(new Api.ReplyInlineMarkup({ rows: [row(), row()] })),
    ).toBeNull();
    expect(mapReplyMarkup(new Api.ReplyInlineMarkup({ rows: [] }))).toBeNull();
  });

  it("ignores reply-keyboard markups, which are composer state", () => {
    expect(mapReplyMarkup(undefined)).toBeNull();
    expect(
      mapReplyMarkup(
        new Api.ReplyKeyboardMarkup({
          rows: [
            new Api.KeyboardButtonRow({
              buttons: [
                new Api.KeyboardButton({
                  text: "Share phone",
                  type: new Api.ButtonTypeRequestPhone(),
                }),
              ],
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(mapReplyMarkup(new Api.ReplyKeyboardHide({}))).toBeNull();
  });
});

describe("mapBotCallbackAnswer", () => {
  it("prefers a message over a url and honours the alert flag", () => {
    expect(
      mapBotCallbackAnswer(
        new Api.messages.BotCallbackAnswer({
          message: "Saved",
          url: "https://ignored.example",
          alert: true,
          cacheTime: 0,
        }),
      ),
    ).toEqual({ kind: "message", text: "Saved", alert: true });
    expect(
      mapBotCallbackAnswer(
        new Api.messages.BotCallbackAnswer({
          message: "Saved",
          cacheTime: 30,
        }),
      ),
    ).toEqual({ kind: "message", text: "Saved", alert: false });
  });

  it("follows a url only when the answer carries no message", () => {
    expect(
      mapBotCallbackAnswer(
        new Api.messages.BotCallbackAnswer({
          url: "https://telo.example/open",
          cacheTime: 0,
        }),
      ),
    ).toEqual({ kind: "url", url: "https://telo.example/open" });
    // An empty message is no message, exactly as Desktop treats it.
    expect(
      mapBotCallbackAnswer(
        new Api.messages.BotCallbackAnswer({
          message: "",
          url: "https://telo.example/open",
          cacheTime: 0,
        }),
      ),
    ).toEqual({ kind: "url", url: "https://telo.example/open" });
  });

  it("is silent when the bot answers with neither", () => {
    expect(
      mapBotCallbackAnswer(
        new Api.messages.BotCallbackAnswer({ cacheTime: 0 }),
      ),
    ).toEqual({ kind: "none" });
  });
});
