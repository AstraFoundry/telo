import { Button } from "shared/ui";

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
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={chosen}
      data-chosen={chosen ? "true" : undefined}
      data-reaction={emoji}
      onClick={onSelect}
      className="group/chip h-10 rounded-full px-1 text-sm font-medium tabular-nums hover:bg-transparent hover:text-current"
    >
      <span
        className={`inline-flex h-[var(--message-reaction-height)] items-center gap-1 rounded-full px-2 transition-[background-color,color] duration-150 ease-out ${
          chosen
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-foreground group-hover/chip:bg-primary/5"
        }`}
      >
        <span className="text-[length:var(--message-reaction-emoji-size)] leading-none">
          {emoji}
        </span>
        {count === undefined ? null : <span>{count}</span>}
      </span>
    </Button>
  );
}
