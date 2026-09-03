import { ArrowUpRight, Copy } from "@phosphor-icons/react";
import { useReducedMotionConfig } from "motion/react";

import type {
  MessageButtonDto,
  MessageKeyboardDto,
} from "../../../../contracts/src/ipc";
import { cn } from "@/shared/lib/cn";
import { safeLink } from "@/shared/lib/safe-link";

export interface MessageKeyboardLabels {
  /** Names the keyboard as a group for screen readers. */
  readonly keyboard: string;
  /** Explains a button variant this build cannot service. */
  readonly unsupported: string;
}

export interface MessageKeyboardProps {
  readonly keyboard: MessageKeyboardDto;
  /** Button id whose press is in flight; the others stay pressable. */
  readonly pendingButtonId?: string | null;
  /**
   * Result of the last press, shown under the keyboard the way Telegram shows
   * a bot's non-alert answer as a toast. The caller clears it.
   */
  readonly notice?: string | null;
  readonly labels: MessageKeyboardLabels;
  onPress(button: MessageButtonDto): void;
  readonly className?: string;
}

/** Shared box of every button in a keyboard, pressable or not. */
const BUTTON_SURFACE =
  "relative flex min-h-10 w-full items-center justify-center overflow-hidden rounded-md px-2.5 text-center text-xs font-semibold";
const BUTTON_ACTION =
  "bg-foreground/8 text-foreground transition-colors hover:bg-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A bot's inline keyboard, attached under the bubble that carries it.
 *
 * Geometry follows Telegram Web K's (`_chatBubble.scss:3752-3800`,
 * `_chatVariables.scss:12-21`): 2px between rows and between buttons, a 40px
 * minimum row, a 6px button radius, and equal widths inside a row. The 40px
 * row is also the smallest target this project ships, so the layout and the
 * hit-area floor agree without a special case.
 *
 * Buttons this build cannot service render as labels rather than as controls
 * that do nothing — the keyboard is part of the bot's message, so dropping
 * rows would misrepresent it, but a dead button is worse than a label.
 */
export function MessageKeyboard({
  keyboard,
  pendingButtonId,
  notice,
  labels,
  onPress,
  className,
}: MessageKeyboardProps) {
  const reduce = useReducedMotionConfig() ?? false;
  const rows = keyboard.rows.filter((row) => row.length > 0);
  if (rows.length === 0) return null;

  return (
    <div className={cn("mt-1 flex flex-col gap-0.5", className)}>
      <div role="group" aria-label={labels.keyboard} className="contents">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex min-h-10 gap-0.5">
            {row.map((button) => (
              <KeyboardButton
                key={button.id}
                button={button}
                pending={pendingButtonId === button.id}
                reduce={reduce}
                labels={labels}
                onPress={onPress}
              />
            ))}
          </div>
        ))}
      </div>
      {notice ? (
        // A bot's non-alert answer is information the reader asked for, so it
        // is announced rather than only drawn.
        <p role="status" className="px-1 pt-0.5 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function KeyboardButton({
  button,
  pending,
  reduce,
  labels,
  onPress,
}: {
  readonly button: MessageButtonDto;
  readonly pending: boolean;
  readonly reduce: boolean;
  readonly labels: MessageKeyboardLabels;
  onPress(button: MessageButtonDto): void;
}) {
  // A url button that survives protocol filtering is a real link, so it is an
  // anchor: middle-click, copy-link, and the OS handoff all come for free,
  // and a synthesised window.open would give up all three.
  const href = button.kind === "url" ? safeLink(button.url ?? "") : null;
  const icon =
    button.kind === "url" ? (
      <ArrowUpRight
        aria-hidden="true"
        className="absolute right-1 top-1 size-3"
      />
    ) : button.kind === "copy" ? (
      <Copy aria-hidden="true" className="absolute right-1 top-1 size-3" />
    ) : null;
  if (button.kind === "unsupported" || (button.kind === "url" && !href)) {
    // The registry's tooltip cannot be imported here — shared/ui siblings go
    // through the barrel, and the barrel re-exports this component. The
    // native title says the same thing to pointer users without a cycle.
    return (
      <span
        title={labels.unsupported}
        className={cn(
          BUTTON_SURFACE,
          "cursor-default bg-foreground/5 text-muted-foreground",
        )}
      >
        <span className="truncate">{button.text}</span>
      </span>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={button.text}
        onClick={(event) => event.stopPropagation()}
        className={cn(BUTTON_SURFACE, BUTTON_ACTION)}
      >
        <span className="truncate">{button.text}</span>
        {icon}
      </a>
    );
  }

  return (
    <button
      type="button"
      // A keyboard can have several presses in flight at once, so only the
      // pressed button reports busy — Telegram Desktop guards per button id
      // for the same reason (`api_bot.cpp:68-70`).
      aria-busy={pending || undefined}
      disabled={pending}
      // Long labels are clipped by Web K with no ellipsis; the title keeps the
      // full text discoverable, which is what tdesktop's tooltip does.
      title={button.text}
      onClick={(event) => {
        event.stopPropagation();
        onPress(button);
      }}
      className={cn(BUTTON_SURFACE, BUTTON_ACTION, "disabled:cursor-default")}
    >
      <span className="truncate">{button.text}</span>
      {icon}
      {pending ? (
        reduce ? (
          // Motion is never the only channel: a frozen bar still says "busy",
          // and `aria-busy` carries it for readers.
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/60"
          />
        ) : (
          // tdesktop sweeps a glare across a button whose callback is in
          // flight, 1100ms per pass (`history_view_element.cpp:344-401`).
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 animate-[telo-button-glare_1.1s_linear_infinite] bg-gradient-to-r from-transparent via-foreground/20 to-transparent"
          />
        )
      ) : null}
    </button>
  );
}
