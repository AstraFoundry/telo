import { Smiley } from "@phosphor-icons/react";
import { useState } from "react";

import type { StickerItemDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "shared/ui";

import { EmojiPanel } from "./emoji-panel";
import { StickerPanel } from "./sticker-panel";

const SECTIONS = ["emoji", "stickers"] as const;

type MediaSection = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<MediaSection, string> = {
  emoji: copy.emojiPicker,
  stickers: copy.stickerPicker,
};

export interface MediaPickerProps {
  readonly disabled: boolean;
  readonly recentEmojis: ReadonlyArray<string>;
  onPickEmoji(glyph: string): void;
  onPickSticker(sticker: StickerItemDto): void;
}

/**
 * Telegram puts emoji and stickers behind one composer button and switches
 * between them with tabs inside the panel, so the field keeps a single
 * expressive affordance next to the attach button.
 *
 * Both sections stay mounted and the inactive one is hidden: switching tabs
 * must not drop a search query, a scroll position, or the loaded sticker sets.
 */
export function MediaPicker({
  disabled,
  recentEmojis,
  onPickEmoji,
  onPickSticker,
}: MediaPickerProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<MediaSection>("emoji");

  const pickEmoji = (glyph: string) => {
    onPickEmoji(glyph);
    setOpen(false);
  };

  const pickSticker = (sticker: StickerItemDto) => {
    onPickSticker(sticker);
    setOpen(false);
  };

  return (
    <MorphPopover open={open} onOpenChange={setOpen}>
      <MorphPopoverTrigger>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={copy.mediaPicker}
          className="size-10 rounded-full"
        >
          <Smiley aria-hidden="true" className="size-4" />
        </Button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        side="top"
        align="start"
        sideOffset={8}
        radius={12}
        // Eight 40px emoji cells plus seven 2px gaps need 334px of content box;
        // at w-84 the grid and the category row both compressed their buttons
        // to 38px to fit, quietly undercutting the 40px pointer target. The
        // sticker grid shares the width so the panel never resizes on a tab.
        className="w-88 p-2"
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            {SECTIONS.map((id) => (
              <Button
                key={id}
                size="sm"
                variant={id === section ? "secondary" : "ghost"}
                aria-pressed={id === section}
                className="rounded-full px-3"
                onClick={() => setSection(id)}
              >
                {SECTION_LABELS[id]}
              </Button>
            ))}
          </div>
          <div hidden={section !== "emoji"}>
            <EmojiPanel recentEmojis={recentEmojis} onPick={pickEmoji} />
          </div>
          <div hidden={section !== "stickers"}>
            <StickerPanel
              active={open && section === "stickers"}
              onPick={pickSticker}
            />
          </div>
        </div>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
