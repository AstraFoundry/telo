import { teloMessageLink } from "../../../../../contracts/src/ipc";
import type { ReplySegment } from "entities/agent";
import type { MentionTarget } from "entities/chat";
import { copy } from "shared/config/copy";
import { Avatar, Tooltip } from "shared/ui";

interface ReplyTextProps {
  readonly segments: ReadonlyArray<ReplySegment>;
  /** Known people and chats, keyed by lower-cased name. */
  readonly targets: ReadonlyMap<string, MentionTarget>;
}

/**
 * An assistant reply as inline prose: citations are small numbered marks
 * that link to the cited message with an in-app `telo://` href, and known
 * names render as chips with the peer's photo. Both sit in the text flow at
 * the point the model wrote them; nothing is appended below the reply.
 */
export function ReplyText({ segments, targets }: ReplyTextProps) {
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.kind === "text") return segment.text;
        if (segment.kind === "mention") {
          return (
            <MentionChip
              key={index}
              name={segment.name}
              target={targets.get(segment.name.toLocaleLowerCase())}
            />
          );
        }
        return (
          <CitationMark
            key={index}
            index={segment.index}
            href={teloMessageLink(segment.chatId, segment.messageId)}
          />
        );
      })}
    </span>
  );
}

/**
 * A superscript-sized number that is an ordinary link: the app-level
 * `telo://` handler turns the click into a jump, so the mark needs no
 * handler of its own and stays a link for keyboard and screen-reader users.
 */
export function CitationMark({ index, href }: { index: number; href: string }) {
  return (
    <Tooltip
      content={copy.agentScrollToMessage}
      wrapperClassName="align-baseline"
    >
      <a
        href={href}
        aria-label={`${copy.agentScrollToMessage} ${index}`}
        // The mark is 16px tall and sits on the baseline; the pseudo-element
        // grows the hit area to a comfortable target without moving text.
        // `no-underline!` outranks the response body's descendant `a` rule.
        className="relative mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-[5px] bg-foreground/8 px-1 text-[10px] leading-none font-medium tabular-nums text-muted-foreground no-underline! transition-colors hover:bg-foreground/14 hover:text-foreground after:absolute after:-inset-1.5 after:content-['']"
      >
        {index}
      </a>
    </Tooltip>
  );
}

/**
 * `@Name` as a chip with the peer's photo. Unknown names stay text with the
 * `@`, so a reply about someone outside the workspace still reads correctly.
 */
export function MentionChip({
  name,
  target,
}: {
  name: string;
  target: MentionTarget | undefined;
}) {
  if (!target) return <>@{name}</>;
  return (
    <span className="mx-px inline whitespace-nowrap rounded-md bg-foreground/8 px-1 py-0.5 align-baseline font-medium text-foreground">
      @
      <Avatar
        src={target.avatarUrl}
        pending={target.avatarPending}
        className="mr-1 ml-0.5 inline-grid size-3.5 align-[-0.2em]"
      />
      {target.name}
    </span>
  );
}
