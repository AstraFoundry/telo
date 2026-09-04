import { Api, helpers } from "teleproto";
import { describe, expect, it } from "vitest";

import { mapMessageReactions } from "./teleproto-message-reactions";

function bucket(
  reaction: Api.TypeReaction,
  count: number,
  chosenOrder?: number,
): Api.ReactionCount {
  return new Api.ReactionCount({ reaction, count, chosenOrder });
}

function emoji(emoticon: string): Api.ReactionEmoji {
  return new Api.ReactionEmoji({ emoticon });
}

function reactions(
  ...results: ReadonlyArray<Api.ReactionCount>
): Api.MessageReactions {
  return new Api.MessageReactions({ results: [...results] });
}

describe("mapMessageReactions", () => {
  it("maps emoji buckets with their counts and the account's pick", () => {
    expect(
      mapMessageReactions(
        reactions(bucket(emoji("👍"), 4, 0), bucket(emoji("🎉"), 1)),
      ),
    ).toEqual([
      { emoji: "👍", count: 4, chosen: true },
      { emoji: "🎉", count: 1, chosen: false },
    ]);
  });

  it("treats the wire's null chosenOrder as not chosen", () => {
    // fromReader materializes an unset flag as null; constructing the object
    // with undefined (the typed shape) would never exercise the real payload.
    const notChosen = Object.assign(bucket(emoji("🎉"), 1), {
      chosenOrder: null,
    });

    expect(
      mapMessageReactions(reactions(notChosen, bucket(emoji("👍"), 4, 0))),
    ).toEqual([
      { emoji: "🎉", count: 1, chosen: false },
      { emoji: "👍", count: 4, chosen: true },
    ]);
  });

  it("keeps Telegram's own bucket order", () => {
    expect(
      mapMessageReactions(
        reactions(
          bucket(emoji("🔥"), 9),
          bucket(emoji("👍"), 3),
          bucket(emoji("😢"), 1),
        ),
      ).map((entry) => entry.emoji),
    ).toEqual(["🔥", "👍", "😢"]);
  });

  it("drops the buckets a chip cannot draw", () => {
    expect(
      mapMessageReactions(
        reactions(
          bucket(
            new Api.ReactionCustomEmoji({
              documentId: helpers.returnBigInt(12345),
            }),
            7,
          ),
          bucket(new Api.ReactionPaid(), 100),
          bucket(emoji("❤️"), 2),
        ),
      ),
    ).toEqual([{ emoji: "❤️", count: 2, chosen: false }]);
  });

  it("reports no reactions for a message that carries none", () => {
    expect(mapMessageReactions(undefined)).toEqual([]);
  });
});
