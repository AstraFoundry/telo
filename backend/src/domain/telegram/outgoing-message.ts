import type { MessageEntityDto } from "../../../../contracts/src/ipc";

/**
 * Trims an outgoing body the way the application layer always has, and shifts
 * composer-authored UTF-16 entity ranges so they still cover the same glyphs
 * after leading/trailing whitespace is dropped. Spans that fall entirely in
 * the trimmed edges are discarded.
 */
export function trimOutgoingMessage(
  body: string,
  entities?: ReadonlyArray<MessageEntityDto>,
): {
  readonly body: string;
  readonly entities: ReadonlyArray<MessageEntityDto> | undefined;
} {
  const trimmed = body.trim();
  if (trimmed === body) return { body: trimmed, entities };
  if (!entities || entities.length === 0) {
    return { body: trimmed, entities };
  }
  const lead = body.length - body.trimStart().length;
  const trailStart = lead + trimmed.length;
  const next = entities.flatMap((entity) => {
    const from = Math.max(entity.offset, lead);
    const to = Math.min(entity.offset + entity.length, trailStart);
    if (to <= from) return [];
    return [{ ...entity, offset: from - lead, length: to - from }];
  });
  return { body: trimmed, entities: next.length > 0 ? next : undefined };
}
