import {
  createContext,
  Fragment,
  useContext,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/cn";
import { safeLink } from "@/shared/lib/safe-link";
import { SpoilerCover } from "@/shared/ui/spoiler-cover";
import type { SpoilerRevealOrigin } from "@/shared/ui/spoiler-cover";

export type RichTextEntityType =
  | "mention"
  | "hashtag"
  | "bot-command"
  | "url"
  | "email"
  | "bold"
  | "italic"
  | "code"
  | "phone"
  | "cashtag"
  | "underline"
  | "strikethrough"
  | "bank-card"
  | "spoiler"
  | "diff-insert"
  | "diff-delete"
  | "pre"
  | "text-link"
  | "text-mention"
  | "custom-emoji"
  | "blockquote"
  | "formatted-date"
  | "diff-replace";

export interface RichTextEntity {
  readonly type: RichTextEntityType;
  readonly offset: number;
  readonly length: number;
  readonly language?: string;
  readonly url?: string;
  readonly userId?: string;
  readonly documentId?: string;
  readonly collapsed?: boolean;
  readonly date?: string;
  readonly oldText?: string;
}

interface EntityNode {
  readonly entity: RichTextEntity;
  readonly index: number;
  readonly children: EntityNode[];
}

function entityEnd(entity: RichTextEntity): number {
  return entity.offset + entity.length;
}

function buildEntityTree(
  body: string,
  entities: ReadonlyArray<RichTextEntity>,
): ReadonlyArray<EntityNode> {
  const candidates = entities
    .map((entity, index) => ({ entity, index, children: [] as EntityNode[] }))
    .filter(
      ({ entity }) =>
        Number.isInteger(entity.offset) &&
        Number.isInteger(entity.length) &&
        entity.offset >= 0 &&
        entity.length > 0 &&
        entityEnd(entity) <= body.length,
    )
    .sort(
      (left, right) =>
        left.entity.offset - right.entity.offset ||
        entityEnd(right.entity) - entityEnd(left.entity) ||
        left.index - right.index,
    );

  const roots: EntityNode[] = [];
  const stack: EntityNode[] = [];
  for (const candidate of candidates) {
    while (
      stack.length > 0 &&
      candidate.entity.offset >= entityEnd(stack.at(-1)!.entity)
    ) {
      stack.pop();
    }
    const parent = stack.at(-1);
    // Telegram emits disjoint or properly nested entities. A malformed
    // crossing range cannot be represented as valid nested HTML, so leave
    // only that range as plain text while preserving every valid entity.
    if (parent && entityEnd(candidate.entity) > entityEnd(parent.entity)) {
      continue;
    }
    if (
      candidate.entity.type === "spoiler" &&
      stack.some((node) => node.entity.type === "spoiler")
    ) {
      continue;
    }
    if (parent) parent.children.push(candidate);
    else roots.push(candidate);
    stack.push(candidate);
  }
  return roots;
}

function entityLink(entity: RichTextEntity, text: string): string | null {
  switch (entity.type) {
    case "url":
      return safeLink(text);
    case "text-link":
      return entity.url ? safeLink(entity.url) : null;
    case "mention": {
      const username = text.startsWith("@") ? text.slice(1) : text;
      return /^[a-zA-Z0-9_]+$/.test(username)
        ? `https://t.me/${username}`
        : null;
    }
    case "email":
      return safeLink(`mailto:${text}`);
    case "phone":
      return safeLink(`tel:${text.replace(/[^+\d]/g, "")}`);
    default:
      return null;
  }
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * Reveal state for every spoiler in one message. Telegram reveals them
 * together — `Ui::Text::String::setSpoilerRevealed` flips the whole text
 * object, not the run that was clicked (`history_view_element.cpp:1362`) —
 * so the state and the cover both live at the message level.
 */
interface SpoilerControl {
  readonly revealing: boolean;
  readonly revealed: boolean;
  reveal(event: ReactMouseEvent<HTMLElement>): void;
}

const SpoilerContext = createContext<SpoilerControl | null>(null);

function Spoiler({
  renderContent,
  revealLabel,
}: {
  renderContent(revealed: boolean): ReactNode;
  revealLabel: string;
}) {
  const control = useContext(SpoilerContext);
  // Without the message-level provider there is no cover to punch, so the
  // run falls back to hiding itself and revealing on click.
  const [localRevealed, setLocalRevealed] = useState(false);
  if (!control) {
    if (localRevealed) return <span>{renderContent(true)}</span>;
    return (
      <button
        type="button"
        aria-label={revealLabel}
        onClick={() => setLocalRevealed(true)}
        className="rounded bg-foreground/80 px-0.5 text-transparent outline-none selection:text-transparent focus-visible:ring-2 focus-visible:ring-ring"
      >
        {renderContent(false)}
      </button>
    );
  }
  // Once the cover is gone the run is ordinary text; leaving it a button
  // would keep advertising a reveal action that has already happened.
  if (control.revealed) return <span>{renderContent(true)}</span>;
  return (
    <button
      type="button"
      data-spoiler
      aria-label={revealLabel}
      onClick={control.reveal}
      // While covered the glyphs are transparent as well, so a cover that
      // failed to paint still hides the text. Once the hole starts growing
      // the text takes its real colour and the cover is what withholds it.
      className={cn(
        "rounded px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !control.revealing &&
          "text-transparent selection:text-transparent [&_*]:text-transparent",
      )}
    >
      {renderContent(control.revealing)}
    </button>
  );
}

/**
 * A custom emoji is a sticker document named from inside the text. The
 * registry primitive cannot fetch it, so the product supplies a renderer and
 * the fallback glyph stands in wherever none is given.
 */
const CustomEmojiContext = createContext<
  ((documentId: string, fallback: ReactNode) => ReactNode) | null
>(null);

function CustomEmoji({
  documentId,
  children,
}: {
  readonly documentId: string;
  readonly children: ReactNode;
}) {
  const render = useContext(CustomEmojiContext);
  if (!render) {
    return <span data-custom-emoji-document-id={documentId}>{children}</span>;
  }
  return <>{render(documentId, children)}</>;
}

function wrapEntity(
  entity: RichTextEntity,
  text: string,
  children: ReactNode,
  linksEnabled: boolean,
): ReactNode {
  const href = linksEnabled ? entityLink(entity, text) : null;
  if (href) return <ExternalLink href={href}>{children}</ExternalLink>;

  switch (entity.type) {
    case "bold":
      return <strong>{children}</strong>;
    case "italic":
      return <em>{children}</em>;
    case "underline":
      return <u className="underline-offset-2">{children}</u>;
    case "strikethrough":
      return <s>{children}</s>;
    case "code":
      return <code>{children}</code>;
    case "pre":
      return (
        <pre data-language={entity.language || undefined}>
          <code>{children}</code>
        </pre>
      );
    case "spoiler":
      return children;
    case "blockquote":
      return (
        <blockquote
          data-collapsed={entity.collapsed || undefined}
          className="my-1 border-l-2 border-primary pl-2 text-foreground/80"
        >
          {children}
        </blockquote>
      );
    case "formatted-date":
      return <time dateTime={entity.date}>{children}</time>;
    case "diff-insert":
      return <ins className="bg-primary/10 no-underline">{children}</ins>;
    case "diff-replace":
      return (
        <ins
          data-old-text={entity.oldText}
          className="bg-primary/10 no-underline"
        >
          {children}
        </ins>
      );
    case "diff-delete":
      return <del className="bg-destructive/10">{children}</del>;
    case "mention":
    case "hashtag":
    case "bot-command":
    case "url":
    case "email":
    case "phone":
    case "cashtag":
    case "text-link":
    case "text-mention":
      return <span className="font-medium text-primary">{children}</span>;
    case "custom-emoji":
      if (!entity.documentId) return <>{children}</>;
      return (
        <CustomEmoji documentId={entity.documentId}>{children}</CustomEmoji>
      );
    case "bank-card":
      return <span className="font-medium tabular-nums">{children}</span>;
  }
}

function renderRange(
  body: string,
  start: number,
  end: number,
  nodes: ReadonlyArray<EntityNode>,
  revealSpoilerLabel: string,
  linksEnabled = true,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = start;
  for (const node of nodes) {
    const nodeEnd = entityEnd(node.entity);
    if (node.entity.offset > cursor) {
      output.push(body.slice(cursor, node.entity.offset));
    }
    const text = body.slice(node.entity.offset, nodeEnd);
    const key = `${node.index}:${node.entity.offset}:${node.entity.length}`;
    output.push(
      <Fragment key={key}>
        {node.entity.type === "spoiler" ? (
          <Spoiler
            revealLabel={revealSpoilerLabel}
            renderContent={(revealed) =>
              renderRange(
                body,
                node.entity.offset,
                nodeEnd,
                node.children,
                revealSpoilerLabel,
                revealed,
              )
            }
          />
        ) : (
          wrapEntity(
            node.entity,
            text,
            renderRange(
              body,
              node.entity.offset,
              nodeEnd,
              node.children,
              revealSpoilerLabel,
              linksEnabled,
            ),
            linksEnabled,
          )
        )}
      </Fragment>,
    );
    cursor = nodeEnd;
  }
  if (cursor < end) output.push(body.slice(cursor, end));
  return output;
}

export function MessageRichText({
  body,
  entities,
  revealSpoilerLabel,
  renderCustomEmoji,
  compact = false,
  className,
}: {
  body: string;
  entities: ReadonlyArray<RichTextEntity>;
  revealSpoilerLabel: string;
  /**
   * Draws the document behind a `custom-emoji` entity. Without it the glyph
   * the entity covers is rendered as plain text, which is Telegram's own
   * fallback when the document is unavailable.
   */
  renderCustomEmoji?: (documentId: string, fallback: ReactNode) => ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [revealFrom, setRevealFrom] = useState<SpoilerRevealOrigin | null>(
    null,
  );
  const [revealed, setRevealed] = useState(false);
  const hasSpoiler = entities.some((entity) => entity.type === "spoiler");

  const control = useMemo<SpoilerControl>(
    () => ({
      revealing: revealFrom !== null,
      revealed,
      reveal: (event) => {
        // The click must not also follow the link or open the media it was
        // covering, which is why the cover swallows it.
        event.preventDefault();
        event.stopPropagation();
        if (!host) return;
        const bounds = host.getBoundingClientRect();
        setRevealFrom({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      },
    }),
    [host, revealFrom, revealed],
  );

  const content = (
    <div
      ref={setHost}
      className={cn(
        "relative whitespace-pre-wrap break-words",
        compact && "line-clamp-1",
        className,
      )}
    >
      {renderRange(
        body,
        0,
        body.length,
        buildEntityTree(body, entities),
        revealSpoilerLabel,
      )}
      {hasSpoiler && !revealed ? (
        <SpoilerCover
          mode="text"
          container={host}
          revealFrom={revealFrom}
          onRevealed={() => setRevealed(true)}
        />
      ) : null}
    </div>
  );

  return (
    <CustomEmojiContext.Provider value={renderCustomEmoji ?? null}>
      {hasSpoiler ? (
        <SpoilerContext.Provider value={control}>
          {content}
        </SpoilerContext.Provider>
      ) : (
        content
      )}
    </CustomEmojiContext.Provider>
  );
}
