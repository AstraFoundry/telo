import type { MessageEntityDto } from "../../../../../contracts/src/ipc";

/** Formatting kinds the composer toolbar authors. Mentions are inserted separately. */
export type ComposerFormatType =
  "bold" | "italic" | "underline" | "strikethrough" | "code" | "spoiler";

export const COMPOSER_FORMATS: readonly ComposerFormatType[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
  "spoiler",
];

/**
 * Common-prefix / common-suffix edit between two UTF-16 strings. Used to
 * shift entity ranges when the textarea reports only the next value.
 */
export function diffEdit(
  previous: string,
  next: string,
): { readonly start: number; readonly end: number; readonly inserted: string } {
  let start = 0;
  const minLen = Math.min(previous.length, next.length);
  while (start < minLen && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { start, end: previousEnd, inserted: next.slice(start, nextEnd) };
}

/**
 * Shifts or shrinks UTF-16 entity ranges around a replacement in `body`.
 * Entities wholly after the replacement slide by the length delta; entities
 * that contain the replacement grow or shrink with it; partial overlaps drop
 * rather than splitting into ambiguous fragments.
 */
export function shiftEntities(
  entities: ReadonlyArray<MessageEntityDto>,
  replaceStart: number,
  replaceEnd: number,
  insertedLength: number,
): MessageEntityDto[] {
  const delta = insertedLength - (replaceEnd - replaceStart);
  return entities.flatMap((entity) => {
    const entityEnd = entity.offset + entity.length;
    if (entityEnd <= replaceStart) return [entity];
    if (entity.offset >= replaceEnd) {
      return [{ ...entity, offset: entity.offset + delta }];
    }
    if (entity.offset < replaceStart && entityEnd > replaceEnd) {
      const length = entity.length + delta;
      return length > 0 ? [{ ...entity, length }] : [];
    }
    return [];
  });
}

export function insertAt(
  body: string,
  entities: ReadonlyArray<MessageEntityDto>,
  start: number,
  end: number,
  text: string,
  extra: ReadonlyArray<MessageEntityDto> = [],
): { readonly body: string; readonly entities: MessageEntityDto[] } {
  const nextBody = `${body.slice(0, start)}${text}${body.slice(end)}`;
  const shifted = shiftEntities(entities, start, end, text.length);
  const added = extra.map((entity) => ({
    ...entity,
    offset: entity.offset + start,
  }));
  return { body: nextBody, entities: [...shifted, ...added] };
}

function isFormat(entity: MessageEntityDto, type: ComposerFormatType): boolean {
  return entity.type === type;
}

function fullyCovers(
  entity: MessageEntityDto,
  offset: number,
  length: number,
): boolean {
  return (
    entity.offset <= offset && entity.offset + entity.length >= offset + length
  );
}

function overlaps(
  entity: MessageEntityDto,
  offset: number,
  length: number,
): boolean {
  const end = offset + length;
  return entity.offset < end && entity.offset + entity.length > offset;
}

function punchHole(
  entity: MessageEntityDto,
  offset: number,
  length: number,
): MessageEntityDto[] {
  const entityEnd = entity.offset + entity.length;
  const holeEnd = offset + length;
  const beforeLength = offset - entity.offset;
  const afterLength = entityEnd - holeEnd;
  const next: MessageEntityDto[] = [];
  if (beforeLength > 0) {
    next.push({ ...entity, length: beforeLength });
  }
  if (afterLength > 0) {
    next.push({ ...entity, offset: holeEnd, length: afterLength });
  }
  return next;
}

/**
 * Toggles a formatting kind over a UTF-16 selection. A selection already
 * fully covered by that kind has it removed (holes punched); otherwise a
 * new span is added. Adjacent same-kind spans are merged afterwards.
 */
export function toggleFormat(
  entities: ReadonlyArray<MessageEntityDto>,
  type: ComposerFormatType,
  offset: number,
  length: number,
): MessageEntityDto[] {
  if (length <= 0) return [...entities];
  const covering = entities.filter(
    (entity) => isFormat(entity, type) && fullyCovers(entity, offset, length),
  );
  const next = covering.length
    ? entities.flatMap((entity) =>
        covering.includes(entity)
          ? punchHole(entity, offset, length)
          : [entity],
      )
    : [
        ...entities.filter(
          (entity) =>
            !(isFormat(entity, type) && overlaps(entity, offset, length)),
        ),
        { type, offset, length } satisfies MessageEntityDto,
      ];
  return mergeAdjacent(next, type);
}

function mergeAdjacent(
  entities: ReadonlyArray<MessageEntityDto>,
  type: ComposerFormatType,
): MessageEntityDto[] {
  const others = entities.filter((entity) => !isFormat(entity, type));
  const same = entities
    .filter((entity) => isFormat(entity, type))
    .slice()
    .sort((left, right) => left.offset - right.offset);
  const merged: MessageEntityDto[] = [];
  for (const entity of same) {
    const previous = merged.at(-1);
    if (previous && previous.offset + previous.length >= entity.offset) {
      const end = Math.max(
        previous.offset + previous.length,
        entity.offset + entity.length,
      );
      merged[merged.length - 1] = {
        ...previous,
        length: end - previous.offset,
      };
    } else {
      merged.push(entity);
    }
  }
  return [...others, ...merged];
}

export function selectionHasFormat(
  entities: ReadonlyArray<MessageEntityDto>,
  type: ComposerFormatType,
  offset: number,
  length: number,
): boolean {
  if (length <= 0) return false;
  return entities.some(
    (entity) => isFormat(entity, type) && fullyCovers(entity, offset, length),
  );
}

/**
 * Drops surrounding whitespace from `body` and shifts UTF-16 entity ranges
 * so they still cover the same glyphs. Spans that lived only in the trimmed
 * edges are discarded.
 */
export function trimOutgoingMessage(
  body: string,
  entities: ReadonlyArray<MessageEntityDto>,
): {
  readonly body: string;
  readonly entities: ReadonlyArray<MessageEntityDto>;
} {
  const trimmed = body.trim();
  if (trimmed === body) return { body: trimmed, entities };
  const lead = body.length - body.trimStart().length;
  const trailStart = lead + trimmed.length;
  const next = entities.flatMap((entity) => {
    const from = Math.max(entity.offset, lead);
    const to = Math.min(entity.offset + entity.length, trailStart);
    if (to <= from) return [];
    return [{ ...entity, offset: from - lead, length: to - from }];
  });
  return { body: trimmed, entities: next };
}
