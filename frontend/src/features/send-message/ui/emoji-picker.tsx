import {
  Airplane,
  ForkKnife,
  Hash,
  Lightbulb,
  PawPrint,
  Smiley,
  SoccerBall,
  User,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { copy } from "shared/config/copy";
import {
  Button,
  Input,
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "shared/ui";

import {
  ALL_EMOJIS,
  EMOJI_CATEGORIES,
  searchEmojis,
  type EmojiCategoryId,
  type EmojiEntry,
} from "../model/emoji-data";

const CATEGORY_ICONS: Record<EmojiCategoryId, ReactNode> = {
  smileys: <Smiley aria-hidden="true" className="size-4" />,
  people: <User aria-hidden="true" className="size-4" />,
  animals: <PawPrint aria-hidden="true" className="size-4" />,
  food: <ForkKnife aria-hidden="true" className="size-4" />,
  activity: <SoccerBall aria-hidden="true" className="size-4" />,
  travel: <Airplane aria-hidden="true" className="size-4" />,
  objects: <Lightbulb aria-hidden="true" className="size-4" />,
  symbols: <Hash aria-hidden="true" className="size-4" />,
};

const CATEGORY_LABELS: Record<EmojiCategoryId, string> = {
  smileys: copy.emojiCategorySmileys,
  people: copy.emojiCategoryPeople,
  animals: copy.emojiCategoryAnimals,
  food: copy.emojiCategoryFood,
  activity: copy.emojiCategoryActivity,
  travel: copy.emojiCategoryTravel,
  objects: copy.emojiCategoryObjects,
  symbols: copy.emojiCategorySymbols,
};

/** One row of the grid is eight 40px cells, so recents stop at one row. */
const RECENT_DISPLAY_MAX = 8;

const glyphNames = new Map(
  ALL_EMOJIS.map((entry) => [entry.glyph, entry.name]),
);

// The dataset declares every EmojiCategoryId exactly once, so the lookup is
// total by construction.
const ENTRIES_BY_CATEGORY = Object.fromEntries(
  EMOJI_CATEGORIES.map((group) => [group.id, group.entries]),
) as Record<EmojiCategoryId, ReadonlyArray<EmojiEntry>>;

function EmojiGrid({
  entries,
  onPick,
}: {
  readonly entries: ReadonlyArray<EmojiEntry>;
  onPick(glyph: string): void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {entries.map((entry) => (
        <button
          key={entry.glyph}
          type="button"
          aria-label={entry.name}
          onClick={() => onPick(entry.glyph)}
          className="grid size-10 place-items-center rounded-lg text-xl leading-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        >
          {entry.glyph}
        </button>
      ))}
    </div>
  );
}

export interface EmojiPickerProps {
  readonly disabled?: boolean;
  /** Recently picked glyphs, most recent first (persisted preference). */
  readonly recentEmojis: ReadonlyArray<string>;
  /** Called with the picked glyph; the host inserts it into the draft. */
  onPick(glyph: string): void;
}

/**
 * Composer emoji affordance: a popover with search, category tabs, and a
 * frequently-used row. The dataset is a curated Unicode subset (see
 * model/emoji-data.ts), not the full emoji catalog.
 */
export function EmojiPicker({
  disabled,
  recentEmojis,
  onPick,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] =
    useState<EmojiCategoryId>("smileys");

  const pick = (glyph: string) => {
    onPick(glyph);
    setOpen(false);
    setQuery("");
  };

  const results = searchEmojis(query);
  const recentEntries = recentEmojis
    .slice(0, RECENT_DISPLAY_MAX)
    .map((glyph) => ({ glyph, name: glyphNames.get(glyph) ?? glyph }));
  const entries = ENTRIES_BY_CATEGORY[activeCategory];

  return (
    <MorphPopover open={open} onOpenChange={setOpen}>
      <MorphPopoverTrigger>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={copy.emojiPicker}
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
        className="w-84 p-2"
      >
        <div className="flex flex-col gap-2">
          <Input
            value={query}
            onChange={setQuery}
            placeholder={copy.searchEmoji}
            aria-label={copy.searchEmoji}
          />
          {query.trim() ? (
            results.length > 0 ? (
              <div className="max-h-64 overflow-y-auto">
                <EmojiGrid entries={results} onPick={pick} />
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {copy.noEmojiFound}
              </p>
            )
          ) : (
            <>
              {recentEntries.length > 0 ? (
                <section>
                  <p className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">
                    {copy.emojiRecent}
                  </p>
                  <EmojiGrid entries={recentEntries} onPick={pick} />
                </section>
              ) : null}
              <div className="flex items-center gap-0.5 border-t border-border pt-1.5">
                {EMOJI_CATEGORIES.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    aria-label={CATEGORY_LABELS[group.id]}
                    aria-pressed={group.id === activeCategory}
                    onClick={() => setActiveCategory(group.id)}
                    className={`grid size-10 place-items-center rounded-lg transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                      group.id === activeCategory
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {CATEGORY_ICONS[group.id]}
                  </button>
                ))}
              </div>
              <div className="max-h-56 overflow-y-auto">
                <EmojiGrid entries={entries} onPick={pick} />
              </div>
            </>
          )}
        </div>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
