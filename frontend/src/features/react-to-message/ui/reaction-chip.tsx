import { useState } from "react";

import { Button, NumberTicker } from "shared/ui";

import { reactionEmojiForDisplay } from "../model/reaction-emoji";
import { ReactionBurst } from "./reaction-burst";

/**
 * The reaction pill: a full-round chip carrying an 18px glyph and, on the
 * bubble's own bar, a tabular counter. Its 28px height matches this surface's
 * hover-rail discs rather than telegram-tt's 30px
 * (`ReactionButton.module.scss`, `--custom-emoji-size: 1.25rem`,
 * `font-variant-numeric: tabular-nums` are the reference proportions), so a
 * row of chips and the rail read as one control family.
 *
 * The pill is deliberately shorter than the 40px target this app owes a dense
 * desktop control, so the pill is a surface inside the button rather than the
 * button itself: the button keeps its full-height hit box and press spring
 * while the pill paints the rail-disc geometry.
 */
export interface ReactionChipProps {
  readonly emoji: string;
  /** Omitted in the picker, where a chip is a choice rather than a tally. */
  readonly count?: number;
  readonly chosen: boolean;
  onSelect(): void;
}

export function ReactionChip({
  emoji,
  count,
  chosen,
  onSelect,
}: ReactionChipProps) {
  // One burst per tap that ADDS the reaction; removing stays quiet, the way
  // Telegram only celebrates the add.
  const [bursts, setBursts] = useState<ReadonlyArray<number>>([]);
  const select = () => {
    if (!chosen && count !== undefined) {
      const id = Date.now() + Math.random();
      setBursts((current) => [...current, id]);
    }
    onSelect();
  };
  const retire = (id: number) =>
    setBursts((current) => current.filter((burst) => burst !== id));
  return (
    <span className="relative inline-flex">
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={chosen}
        data-chosen={chosen ? "true" : undefined}
        data-reaction={emoji}
        onClick={select}
        className="group/chip h-10 rounded-full px-1 text-sm font-medium tabular-nums hover:bg-transparent hover:text-current"
      >
        <span
          className={`inline-flex h-[var(--message-reaction-height)] items-center gap-1 rounded-full px-2 transition-[background-color,color] duration-150 ease-out ${
            chosen
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-card text-foreground group-hover/chip:bg-primary/5"
          }`}
        >
          <span className="text-[length:var(--message-reaction-emoji-size)] leading-none [font-variant-emoji:emoji]">
            {reactionEmojiForDisplay(emoji)}
          </span>
          {count === undefined ? null : (
            <NumberTicker value={count} startOnView={false} duration={0.35} />
          )}
        </span>
      </Button>
      {bursts.map((id) => (
        <ReactionBurst
          key={id}
          emoji={emoji}
          seed={id}
          onDone={() => retire(id)}
        />
      ))}
    </span>
  );
}
