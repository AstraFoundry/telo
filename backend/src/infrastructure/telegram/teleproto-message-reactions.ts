import { Api } from "teleproto";

import type { MessageReactionDto } from "../../../../contracts/src/ipc";

/**
 * Maps Telegram's `MessageReactions` onto the transport buckets, keeping the
 * server's order: `results` already arrives most-reacted first, which is the
 * order both reference clients draw the chips in (Desktop's
 * `message_reactions.cpp`, Web K's `reactions.ts`) — sorting locally would
 * disagree with the server's own tie-breaking.
 *
 * Only `ReactionEmoji` buckets survive. `ReactionCustomEmoji` and
 * `ReactionPaid` name a document instead of a glyph, so a chip has nothing to
 * draw for them; a message carrying only those reports no reactions, which is
 * the shape `MessageReactionDto` documents.
 *
 * `chosenOrder` is Telegram's index of this account's picks among its own
 * reactions. Its presence marks a bucket as chosen; the index itself only
 * orders premium multi-reactions, which this client does not send. The wire
 * delivers an unset flag as `null` (teleproto `fromReader` materializes
 * absent flags as null, not undefined), so the test is `!= null` — an
 * `!== undefined` check marks every bucket chosen.
 */
export function mapMessageReactions(
  reactions: Api.MessageReactions | undefined,
): ReadonlyArray<MessageReactionDto> {
  if (!reactions) return [];
  const buckets: Array<MessageReactionDto> = [];
  for (const bucket of reactions.results) {
    if (!(bucket.reaction instanceof Api.ReactionEmoji)) continue;
    buckets.push({
      emoji: bucket.reaction.emoticon,
      count: bucket.count,
      chosen: bucket.chosenOrder != null,
    });
  }
  return buckets;
}
