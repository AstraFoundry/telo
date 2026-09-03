import { useMemo } from "react";

import type { AgentMessage } from "entities/agent";
import { parseReply } from "entities/agent";
import type { MentionTarget } from "entities/chat";
import { StreamingResponse } from "shared/ui";

import { useSmoothReveal } from "../lib/use-smooth-stream";
import { revealSegments, withoutTrailingLink } from "../model/reveal-segments";
import { ReplyText } from "./reply-text";

interface AssistantMessageBodyProps {
  readonly message: AgentMessage;
  readonly streaming: boolean;
  readonly running: boolean;
  /** Known people and chats, keyed by lower-cased name. */
  readonly mentionTargets: ReadonlyMap<string, MentionTarget>;
}

/**
 * An assistant reply rendered as prose with inline citation marks and
 * mention chips. The copy action gets the plain text without links. While
 * streaming, the text is revealed evenly rather than in the provider's
 * chunks; marks and chips surface at the point the reveal reaches them.
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
  const parsed = useMemo(
    () => parseReply(withoutTrailingLink(message.body, streaming), names),
    [message.body, streaming, names],
  );
  const shown = useSmoothReveal(parsed.text.length, streaming);
  const segments = streaming
    ? revealSegments(parsed.segments, shown)
    : parsed.segments;
  return (
    <StreamingResponse
      status={streaming ? "streaming" : "complete"}
      copyText={parsed.text}
      showActions={!running}
    >
      <ReplyText segments={segments} targets={mentionTargets} />
    </StreamingResponse>
  );
}
