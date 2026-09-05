import type { CSSProperties } from "react";

import { useMessageTextSize } from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "shared/ui";

interface ConversationPreviewProps {
  /**
   * Text for the incoming bubble. Callers pass a real line out of the chat
   * list when there is one, so the preview shows the reader's own words at
   * the size they just chose rather than a lorem sample.
   */
  readonly incoming?: string;
}

/**
 * Two bubbles on the chat background, drawn with the transcript's own
 * primitives and its own tokens: the bubble metrics, the backdrop custom
 * property and the message font size all come from the same places the real
 * conversation reads them.
 *
 * That is the point - it is not a picture of the settings, it is the same
 * component tree under the same variables, so it cannot drift from what the
 * conversation will look like once the reader goes back to it.
 *
 * Neither bubble carries an author line: a one-to-one chat has no sender
 * names above its bubbles in any Telegram client, and this preview is about
 * type and colour, not about chat structure.
 */
export function ConversationPreview({ incoming }: ConversationPreviewProps) {
  const { value: textSize } = useMessageTextSize();

  return (
    <div
      aria-label={copy.appearancePreview}
      role="img"
      // The 12px inner radius sits inside the group card's 16px, so the
      // nested corners stay concentric with a 4px inset.
      className="conversation-backdrop flex flex-col gap-[var(--message-run-gap)] rounded-xl bg-background p-4"
      style={{ "--message-font-size": `${textSize}px` } as CSSProperties}
    >
      <Message from="assistant">
        <MessageContent>
          <MessageBubble variant="soft">
            <MessageBubbleContent className="rounded-[var(--message-bubble-radius)] px-[var(--message-bubble-padding-x)] py-[var(--message-bubble-padding-y)] text-[length:var(--message-font-size,14px)] leading-[var(--message-line-height)]">
              {incoming ?? copy.previewIncomingMessage}
            </MessageBubbleContent>
          </MessageBubble>
        </MessageContent>
      </Message>
      <Message from="user">
        <MessageContent>
          <MessageBubble variant="tint">
            <MessageBubbleContent className="rounded-[var(--message-bubble-radius)] px-[var(--message-bubble-padding-x)] py-[var(--message-bubble-padding-y)] text-[length:var(--message-font-size,14px)] leading-[var(--message-line-height)]">
              {copy.previewOutgoingMessage}
            </MessageBubbleContent>
          </MessageBubble>
        </MessageContent>
      </Message>
    </div>
  );
}
