import { parseTeloLink } from "../../../../../contracts/src/ipc";

export interface ReplyCitation {
  readonly chatId: string;
  readonly messageId: string;
}

export type ReplySegment =
  | { readonly kind: "text"; readonly text: string }
  /** An in-app message link; `index` is its 1-based number in the reply. */
  | {
      readonly kind: "citation";
      readonly chatId: string;
      readonly messageId: string;
      readonly index: number;
    }
  /** `@Name` for a person or chat the workspace knows; `name` is canonical. */
  | { readonly kind: "mention"; readonly name: string };

export interface ParsedReply {
  readonly segments: ReadonlyArray<ReplySegment>;
  /** The reply as plain text: links removed, mentions kept as `@Name`. */
  readonly text: string;
  /** Cited messages in order of first appearance, deduplicated. */
  readonly citations: ReadonlyArray<ReplyCitation>;
}

// A citation is a bare `telo://message/…` link, optionally wrapped the way a
// model tends to wrap links: markdown `[label](link)` or autolink `<link>`.
const LINK_PATTERN =
  /\[[^\]\n]*\]\((telo:\/\/[^\s)]+)\)|<(telo:\/\/[^\s>]+)>|(telo:\/\/[^\s<>()[\]]+)/g;
// Sentence punctuation glued to a bare link belongs to the prose.
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
// Older replies cite with this marker; it carries no chat so it just drops.
const LEGACY_CITATION = /\[\[telo-cite:[^\]]*\]\]/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches `@Name` at a token boundary for the known names only, longest
 * first so "Lev Kim" wins over "Lev". Null when there is nothing to match.
 */
function mentionPattern(names: ReadonlyArray<string>): RegExp | null {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length);
  const alternation = unique.map(escapeRegExp).join("|");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])@(${alternation})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
}

function splitMentions(
  text: string,
  pattern: RegExp | null,
  canonical: ReadonlyMap<string, string>,
  out: ReplySegment[],
): void {
  if (!pattern || !text) {
    if (text) out.push({ kind: "text", text });
    return;
  }
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const lead = match[1] ?? "";
    const start = match.index + lead.length;
    const before = text.slice(cursor, start);
    if (before) out.push({ kind: "text", text: before });
    const name = canonical.get(match[2]!.toLocaleLowerCase()) ?? match[2]!;
    out.push({ kind: "mention", name });
    cursor = match.index + match[0].length;
  }
  const rest = text.slice(cursor);
  if (rest) out.push({ kind: "text", text: rest });
}

/**
 * Trims the whitespace a citation follows so the number sits on the sentence
 * it cites: one space, or a line break when the model put the link on its
 * own line, never more than that.
 */
function trimBeforeCitation(text: string): string {
  return text.replace(/(?:\n[ \t]*| )$/, "");
}

/**
 * Splits an assistant reply into renderable segments. In-app message links
 * become numbered citations, `@Name` tokens of known workspace names become
 * mentions, everything else stays text. The plain-text form (for copying)
 * carries no links.
 */
export function parseReply(
  body: string,
  mentionNames: ReadonlyArray<string> = [],
): ParsedReply {
  const source = body.replace(LEGACY_CITATION, "");
  const canonical = new Map(
    mentionNames.map((name) => [name.toLocaleLowerCase(), name] as const),
  );
  const mentions = mentionPattern(mentionNames);
  const segments: ReplySegment[] = [];
  const citations: ReplyCitation[] = [];
  const indexByKey = new Map<string, number>();
  let cursor = 0;

  const pushText = (text: string): void =>
    splitMentions(text, mentions, canonical, segments);

  for (const match of source.matchAll(LINK_PATTERN)) {
    const bare = match[3];
    let href = match[1] ?? match[2] ?? bare!;
    let tail = "";
    if (bare) {
      const punctuation = TRAILING_PUNCTUATION.exec(bare)?.[0] ?? "";
      href = bare.slice(0, bare.length - punctuation.length);
      tail = punctuation;
    }
    const link = parseTeloLink(href);
    if (!link) continue;
    pushText(trimBeforeCitation(source.slice(cursor, match.index)));
    const key = `${link.chatId}/${link.messageId}`;
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = citations.length + 1;
      indexByKey.set(key, index);
      citations.push({ chatId: link.chatId, messageId: link.messageId });
    }
    segments.push({
      kind: "citation",
      chatId: link.chatId,
      messageId: link.messageId,
      index,
    });
    cursor = match.index + match[0].length - tail.length;
  }
  pushText(source.slice(cursor));

  const text = segments
    .map((segment) =>
      segment.kind === "text"
        ? segment.text
        : segment.kind === "mention"
          ? `@${segment.name}`
          : "",
    )
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();

  return { segments: mergeText(segments), text, citations };
}

// Adjacent text pieces (left by trimming or by a dropped legacy marker) merge
// so React keys stay stable and whitespace is easy to reason about.
function mergeText(segments: ReadonlyArray<ReplySegment>): ReplySegment[] {
  const merged: ReplySegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (segment.kind === "text" && last?.kind === "text") {
      merged[merged.length - 1] = {
        kind: "text",
        text: last.text + segment.text,
      };
    } else if (segment.kind !== "text" || segment.text) {
      merged.push(segment);
    }
  }
  return merged;
}
