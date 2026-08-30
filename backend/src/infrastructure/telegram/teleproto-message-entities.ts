import { Api } from "teleproto";

import type { MessageEntityDto } from "../../../../contracts/src/ipc";

type EntityRange = Pick<MessageEntityDto, "offset" | "length">;

function validRange(
  body: string,
  entity: Api.TypeMessageEntity,
): EntityRange | null {
  const { offset, length } = entity;
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length <= 0 ||
    offset + length > body.length
  ) {
    return null;
  }
  return { offset, length };
}

function mapEntity(
  entity: Api.TypeMessageEntity,
  range: EntityRange,
): MessageEntityDto | null {
  if (entity instanceof Api.MessageEntityMention)
    return { ...range, type: "mention" };
  if (entity instanceof Api.MessageEntityHashtag)
    return { ...range, type: "hashtag" };
  if (entity instanceof Api.MessageEntityBotCommand)
    return { ...range, type: "bot-command" };
  if (entity instanceof Api.MessageEntityUrl) return { ...range, type: "url" };
  if (entity instanceof Api.MessageEntityEmail)
    return { ...range, type: "email" };
  if (entity instanceof Api.MessageEntityBold)
    return { ...range, type: "bold" };
  if (entity instanceof Api.MessageEntityItalic)
    return { ...range, type: "italic" };
  if (entity instanceof Api.MessageEntityCode)
    return { ...range, type: "code" };
  if (entity instanceof Api.MessageEntityPre)
    return { ...range, type: "pre", language: entity.language };
  if (entity instanceof Api.MessageEntityTextUrl)
    return { ...range, type: "text-link", url: entity.url };
  if (entity instanceof Api.MessageEntityMentionName)
    return {
      ...range,
      type: "text-mention",
      userId: entity.userId.toString(),
    };
  if (entity instanceof Api.MessageEntityPhone)
    return { ...range, type: "phone" };
  if (entity instanceof Api.MessageEntityCashtag)
    return { ...range, type: "cashtag" };
  if (entity instanceof Api.MessageEntityUnderline)
    return { ...range, type: "underline" };
  if (entity instanceof Api.MessageEntityStrike)
    return { ...range, type: "strikethrough" };
  if (entity instanceof Api.MessageEntityBankCard)
    return { ...range, type: "bank-card" };
  if (entity instanceof Api.MessageEntitySpoiler)
    return { ...range, type: "spoiler" };
  if (entity instanceof Api.MessageEntityCustomEmoji)
    return {
      ...range,
      type: "custom-emoji",
      documentId: entity.documentId.toString(),
    };
  if (entity instanceof Api.MessageEntityBlockquote)
    return {
      ...range,
      type: "blockquote",
      collapsed: Boolean(entity.collapsed),
    };
  if (entity instanceof Api.MessageEntityFormattedDate) {
    const date = new Date(entity.date * 1000);
    if (Number.isNaN(date.getTime())) return null;
    return {
      ...range,
      type: "formatted-date",
      date: date.toISOString(),
      relative: Boolean(entity.relative),
      shortTime: Boolean(entity.shortTime),
      longTime: Boolean(entity.longTime),
      shortDate: Boolean(entity.shortDate),
      longDate: Boolean(entity.longDate),
      dayOfWeek: Boolean(entity.dayOfWeek),
    };
  }
  if (entity instanceof Api.MessageEntityDiffInsert)
    return { ...range, type: "diff-insert" };
  if (entity instanceof Api.MessageEntityDiffReplace)
    return { ...range, type: "diff-replace", oldText: entity.oldText };
  if (entity instanceof Api.MessageEntityDiffDelete)
    return { ...range, type: "diff-delete" };
  return null;
}

/**
 * Converts Telegram's UTF-16 ranges into the transport model. Unknown and
 * malformed entities remain plain text instead of producing unsafe or broken
 * renderer markup.
 */
export function mapMessageEntities(
  body: string,
  entities: ReadonlyArray<Api.TypeMessageEntity> | undefined,
): ReadonlyArray<MessageEntityDto> {
  if (!entities) return [];
  return entities.flatMap((entity) => {
    const range = validRange(body, entity);
    if (!range) return [];
    const mapped = mapEntity(entity, range);
    return mapped ? [mapped] : [];
  });
}

function mapEntityForSend(
  body: string,
  entity: MessageEntityDto,
): Api.TypeMessageEntity | null {
  if (
    !Number.isInteger(entity.offset) ||
    !Number.isInteger(entity.length) ||
    entity.offset < 0 ||
    entity.length <= 0 ||
    entity.offset + entity.length > body.length
  ) {
    return null;
  }
  const range = { offset: entity.offset, length: entity.length };
  switch (entity.type) {
    case "bold":
      return new Api.MessageEntityBold(range);
    case "italic":
      return new Api.MessageEntityItalic(range);
    case "underline":
      return new Api.MessageEntityUnderline(range);
    case "strikethrough":
      return new Api.MessageEntityStrike(range);
    case "code":
      return new Api.MessageEntityCode(range);
    case "pre":
      return new Api.MessageEntityPre({ ...range, language: entity.language });
    case "spoiler":
      return new Api.MessageEntitySpoiler(range);
    case "blockquote":
      return new Api.MessageEntityBlockquote({
        ...range,
        collapsed: entity.collapsed,
      });
    case "text-link":
      return new Api.MessageEntityTextUrl({ ...range, url: entity.url });
    case "text-mention":
      return new Api.MessageEntityMentionName({
        ...range,
        userId: BigInt(entity.userId) as never,
      });
    case "mention":
      return new Api.MessageEntityMention(range);
    default:
      // Receive-only kinds (hashtags, urls, emails, …) are generated
      // server-side; the composer never authors them.
      return null;
  }
}

/**
 * Inverse of `mapMessageEntities` for the send path: composer-authored
 * formatting spans become Teleproto formatting entities. Out-of-range spans
 * and receive-only kinds drop out rather than corrupting the message, the
 * same tolerance the receive mapping applies.
 */
export function mapMessageEntitiesForSend(
  body: string,
  entities: ReadonlyArray<MessageEntityDto> | undefined,
): Api.TypeMessageEntity[] | undefined {
  if (!entities || entities.length === 0) return undefined;
  const mapped = entities.flatMap((entity) => {
    const result = mapEntityForSend(body, entity);
    return result ? [result] : [];
  });
  return mapped.length > 0 ? mapped : undefined;
}
