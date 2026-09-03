import type { ReplySegment } from "entities/agent";

/**
 * The prefix of a segmented reply that `shown` plain-text characters cover,
 * so the smooth reveal can run over a reply that mixes prose with mention
 * chips and citation marks. Text is cut mid-segment; a mention appears only
 * once its whole `@Name` would have been typed; a citation appears together
 * with the last character of the sentence it follows.
 */
export function revealSegments(
  segments: ReadonlyArray<ReplySegment>,
  shown: number,
): ReplySegment[] {
  const out: ReplySegment[] = [];
  let remaining = shown;
  for (const segment of segments) {
    if (segment.kind === "citation") {
      out.push(segment);
      continue;
    }
    const length =
      segment.kind === "text" ? segment.text.length : segment.name.length + 1;
    if (remaining <= 0) break;
    if (remaining >= length) {
      out.push(segment);
      remaining -= length;
      continue;
    }
    if (segment.kind === "text") {
      out.push({ kind: "text", text: segment.text.slice(0, remaining) });
    }
    break;
  }
  return out;
}

/**
 * A link still arriving at the end of a streamed body would parse as a
 * shorter, wrong citation; hold the tail back until whitespace closes it.
 */
export function withoutTrailingLink(body: string, streaming: boolean): string {
  if (!streaming) return body;
  return body.replace(/\s?telo:\/\/\S*$/, "");
}
