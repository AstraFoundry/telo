const CITATION_PATTERN = /\[\[telo-cite:([^\]]+)\]\]/g;
const CITATION_ONLY_LINE = /^\s*\[\[telo-cite:[^\]]+\]\]\s*$/;

export interface ParsedCitations {
  /** The reply text with citation markers removed. */
  readonly text: string;
  /** Referenced message ids, in order of first appearance, deduplicated. */
  readonly messageIds: ReadonlyArray<string>;
}

/**
 * Splits an assistant reply into displayable text and the message ids it
 * cites. Lines that hold only a citation marker drop out entirely; inline
 * markers are removed in place.
 */
export function parseCitations(body: string): ParsedCitations {
  const messageIds: Array<string> = [];
  for (const match of body.matchAll(CITATION_PATTERN)) {
    if (!messageIds.includes(match[1])) messageIds.push(match[1]);
  }
  if (messageIds.length === 0) return { text: body, messageIds };
  const text = body
    .split("\n")
    .filter((line) => !CITATION_ONLY_LINE.test(line))
    .join("\n")
    .replace(CITATION_PATTERN, "")
    .trimEnd();
  return { text, messageIds };
}
