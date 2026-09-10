import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useRef } from "react";

import { copy } from "shared/config/copy";
import { scrollFadeMask, useScrollFade } from "shared/lib/use-scroll-fade";
import { Button, EASE_OUT, JumpToLatest } from "shared/ui";

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  onSelect(): void;
}

interface SuggestionPillsProps {
  readonly suggestions: ReadonlyArray<Suggestion>;
  readonly disabled: boolean;
  /** True while the transcript is scrolled away from its live edge. */
  readonly showJump: boolean;
  onJump(): void;
}

/**
 * The strip that floats over the bottom of the transcript, directly above
 * the composer: follow-up prompts as small borderless pills that scroll
 * sideways under a fading mask, and — once the transcript is scrolled up —
 * a round button at the right edge that returns to the latest reply. Both
 * leave when they have nothing to do so the transcript keeps its room.
 */
export function SuggestionPills({
  suggestions,
  disabled,
  showJump,
  onJump,
}: SuggestionPillsProps) {
  const reduce = useReducedMotionConfig() ?? false;
  const railRef = useRef<HTMLDivElement>(null);
  const edges = useScrollFade(railRef, "horizontal");
  const maskImage = scrollFadeMask(edges, "horizontal", "1.25rem");
  const transition = { duration: reduce ? 0.12 : 0.18, ease: EASE_OUT };
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-2 flex h-7 items-center">
      <AnimatePresence initial={false}>
        {suggestions.length > 0 ? (
          <motion.div
            key="suggestions"
            ref={railRef}
            role="list"
            aria-label={copy.agentSuggestions}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            transition={transition}
            style={{ maskImage, WebkitMaskImage: maskImage }}
            className={
              // The rail shrinks for the jump button so the last pill is not
              // hidden under it; the mask fades whatever is clipped.
              showJump
                ? "pointer-events-auto flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-9 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : "pointer-events-auto flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            }
          >
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} role="listitem" className="shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  // Pills are 28px tall to stay out of the transcript's way;
                  // the pseudo-element restores the 40px vertical target.
                  className="relative h-7 rounded-full bg-background/90 px-2.5 text-xs font-normal text-muted-foreground shadow-xs backdrop-blur-sm hover:bg-muted hover:text-foreground after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
                  onClick={suggestion.onSelect}
                >
                  {suggestion.label}
                </Button>
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <JumpToLatest
        show={showJump}
        onJump={onJump}
        size="sm"
        className="pointer-events-auto absolute right-0"
      />
    </div>
  );
}
