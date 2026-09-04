import { useEffect, type ReactNode } from "react";

import { useChatStore } from "entities/chat";
import { useLoopStickers } from "entities/preferences";
import { copy } from "shared/config/copy";
import { Sticker } from "shared/ui";

/**
 * Telegram draws a custom emoji at the height of the line it sits on, so it
 * reads as a character rather than as an attachment wedged into a sentence.
 */
const INLINE_PX = 20;

/**
 * A `custom-emoji` entity names a sticker document from inside the text. Until
 * that document resolves and downloads, the glyph the entity covers stands in
 * — which is also Telegram's fallback when the document is unavailable, so a
 * missing emoji never leaves a hole in the sentence.
 */
export function CustomEmoji({
  documentId,
  fallback,
}: {
  readonly documentId: string;
  readonly fallback: ReactNode;
}) {
  const item = useChatStore((state) => state.customEmoji[documentId]);
  const loadCustomEmoji = useChatStore((state) => state.loadCustomEmoji);
  const download = useChatStore((state) =>
    item ? (state.mediaDownloads[item.id] ?? null) : null,
  );
  const downloadMedia = useChatStore((state) => state.downloadMedia);
  const { value: loopStickers } = useLoopStickers();

  const unresolved = item === undefined;
  useEffect(() => {
    if (unresolved) void loadCustomEmoji(documentId);
  }, [unresolved, loadCustomEmoji, documentId]);

  const mediaId = item?.id;
  const needsDownload = mediaId !== undefined && download === null;
  useEffect(() => {
    if (needsDownload && mediaId) void downloadMedia(mediaId);
  }, [needsDownload, mediaId, downloadMedia]);

  if (!item) return <>{fallback}</>;

  return (
    <span className="inline-block align-text-bottom">
      <Sticker
        sticker={{
          emoji: item.emoji,
          format: item.format,
          setReference: null,
          outlinePath: item.outlinePath,
        }}
        width={item.width}
        height={item.height}
        src={download?.state === "ready" ? download.url : null}
        label={copy.sticker}
        playLabel={copy.playSticker}
        maxSize={INLINE_PX}
        loop={loopStickers}
      />
    </span>
  );
}
