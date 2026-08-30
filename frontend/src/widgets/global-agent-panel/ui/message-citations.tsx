import { useChatStore } from "entities/chat";
import { copy } from "shared/config/copy";
import { Button, Tooltip } from "shared/ui";

interface MessageCitationsProps {
  /** Chat the citing run was reading; undefined renders the chips disabled. */
  readonly chatId: string | undefined;
  readonly messageIds: ReadonlyArray<string>;
}

/**
 * Numbered citation chips under an agent reply. Clicking one selects the
 * chat when needed and scrolls the cited message into view via the shared
 * jump loader; chips of reloaded threads (no known chat) render disabled
 * with an explanation instead of failing silently.
 */
export function MessageCitations({
  chatId,
  messageIds,
}: MessageCitationsProps) {
  const requestJumpToMessage = useChatStore(
    (state) => state.requestJumpToMessage,
  );
  return (
    <ul aria-label={copy.agentCitations} className="flex flex-wrap gap-1.5">
      {messageIds.map((messageId, index) => (
        <li key={messageId}>
          {chatId ? (
            <Tooltip content={copy.agentScrollToMessage}>
              <Button
                variant="outline"
                size="sm"
                aria-label={`${copy.agentScrollToMessage} ${index + 1}`}
                className="tabular-nums"
                onClick={() => void requestJumpToMessage(chatId, messageId)}
              >
                {index + 1}
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content={copy.agentCitationUnavailable}>
              <Button
                variant="outline"
                size="sm"
                disabled
                aria-label={`${copy.agentScrollToMessage} ${index + 1}`}
                className="tabular-nums"
              >
                {index + 1}
              </Button>
            </Tooltip>
          )}
        </li>
      ))}
    </ul>
  );
}
