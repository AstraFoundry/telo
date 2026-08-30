import type {
  MessageDto,
  MessageFileMediaDto,
} from "../../../../../contracts/src/ipc";

const VISUAL_KINDS = new Set(["photo", "video", "animation", "video-note"]);

export type VisualMediaDto = MessageFileMediaDto & {
  readonly kind: "photo" | "video" | "animation" | "video-note";
};

export function isVisualMedia(
  media: MessageDto["media"],
): media is VisualMediaDto {
  return (
    media !== null && media.kind !== "webpage" && VISUAL_KINDS.has(media.kind)
  );
}

/**
 * The download slot a message's media uses: file media downloads under its
 * own id, while a link preview's photo downloads under `thumbnailMediaId`.
 * Null when the media has nothing downloadable (a thumbnail-less webpage).
 */
export function mediaDownloadKey(
  media: NonNullable<MessageDto["media"]>,
): string | null {
  return media.kind === "webpage" ? media.thumbnailMediaId : media.id;
}

/**
 * Render unit for the transcript: a single message, or an album — the run of
 * consecutive messages sharing one `groupedId` when every member is visual
 * media. Non-visual members break the run back into single messages so a
 * mixed group never renders as a photo grid.
 */
export interface TranscriptUnit {
  readonly key: string;
  /** Index of the unit's first message in the transcript. */
  readonly startIndex: number;
  readonly messages: ReadonlyArray<MessageDto>;
}

export function groupTranscript(
  messages: ReadonlyArray<MessageDto>,
): ReadonlyArray<TranscriptUnit> {
  const units: TranscriptUnit[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.groupedId && isVisualMedia(message.media)) {
      const album = [message];
      let next = index + 1;
      while (
        next < messages.length &&
        messages[next].groupedId === message.groupedId &&
        isVisualMedia(messages[next].media)
      ) {
        album.push(messages[next]);
        next += 1;
      }
      if (album.length > 1) {
        units.push({
          key: `album-${message.groupedId}`,
          startIndex: index,
          messages: album,
        });
        index = next;
        continue;
      }
    }
    units.push({ key: message.id, startIndex: index, messages: [message] });
    index += 1;
  }
  return units;
}
