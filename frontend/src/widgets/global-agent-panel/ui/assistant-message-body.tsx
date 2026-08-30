import type { AgentMessage } from "entities/agent";
import { parseCitations } from "entities/agent";
import { StreamingResponse } from "shared/ui";

import { MessageCitations } from "./message-citations";

interface AssistantMessageBodyProps {
  readonly message: AgentMessage;
  readonly streaming: boolean;
  readonly running: boolean;
}

/**
 * An assistant reply with its citation markers stripped from the text and
 * rendered as jump chips instead. The copy action gets the cleaned text, not
 * the raw markers.
 */
export function AssistantMessageBody({
  message,
  streaming,
  running,
}: AssistantMessageBodyProps) {
  const parsed = parseCitations(message.body);
  return (
    <>
      <StreamingResponse
        status={streaming ? "streaming" : "complete"}
        copyText={parsed.text}
        // Errors are diagnostics, not answers: no copy or feedback actions.
        showActions={!running && !message.error}
      >
        {parsed.text}
      </StreamingResponse>
      {parsed.messageIds.length > 0 && !message.error ? (
        <MessageCitations
          chatId={message.chatId}
          messageIds={parsed.messageIds}
        />
      ) : null}
    </>
  );
}
