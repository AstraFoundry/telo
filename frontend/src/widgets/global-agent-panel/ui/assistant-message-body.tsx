import { useMemo } from "react";

import type { AgentMessage } from "entities/agent";
import type { MentionTarget } from "entities/chat";
import { StreamingResponse } from "shared/ui";

import { useFrameCoalescedValue } from "../lib/use-frame-coalesced-value";
import {
  collectReplyCitations,
  replyMarkdownPlainText,
  withoutTrailingTeloLink,
} from "../model/reply-markdown";
import { AgentMarkdown } from "./agent-markdown";

interface AssistantMessageBodyProps {
  readonly message: AgentMessage;
  readonly streaming: boolean;
  readonly running: boolean;
  /** Known people and chats, keyed by lower-cased name. */
  readonly mentionTargets: ReadonlyMap<string, MentionTarget>;
}

/**
 * A streamed Markdown reply with inline citation marks and mention chips.
 * Parsing incomplete syntax is delegated to Streamdown; app-specific links
 * are transformed only after Markdown parsing so code remains literal.
 */
export function AssistantMessageBody({
  message,
  streaming,
  running,
  mentionTargets,
}: AssistantMessageBodyProps) {
  const names = useMemo(
    () => [...mentionTargets.values()].map((target) => target.name),
    [mentionTargets],
  );
  const incomingBody = useMemo(
    () => withoutTrailingTeloLink(message.body, streaming),
    [message.body, streaming],
  );
  const body = useFrameCoalescedValue(incomingBody, streaming);
  const citations = useMemo(() => collectReplyCitations(body), [body]);
  // Completion actions are hidden while streaming, so their plain-text value
  // does not need a second full Markdown parse for every incoming frame.
  const copyText = useMemo(
    () => (streaming ? undefined : replyMarkdownPlainText(body)),
    [body, streaming],
  );
  return (
    <StreamingResponse
      status={streaming ? "streaming" : "complete"}
      copyText={copyText}
      showActions={!running}
    >
      <AgentMarkdown
        body={body}
        streaming={streaming}
        citations={citations}
        mentionTargets={mentionTargets}
        mentionNames={names}
      />
    </StreamingResponse>
  );
}
