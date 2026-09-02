import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { PressableBlock } from "./pressable-block";

export interface SettingsGroupProps {
  /** Group caption. Omitted when the pane title already names the group. */
  readonly title?: string;
  /**
   * A consequence that belongs to the whole group, printed under the card. A
   * fact about one setting goes on that row instead, never in both places.
   */
  readonly description?: string;
  /** Ids of the caption and description, so the group can point at them. */
  readonly titleId?: string;
  readonly descriptionId?: string;
  readonly children: ReactNode;
}

/**
 * Grouped inset card, the shape desktop settings surfaces converge on: rows
 * carry hairlines between them and whitespace separates the groups, so a
 * divider never lands between two unrelated settings.
 *
 * The card's 12px radius sits outside the rows' 16px padding, which keeps the
 * nested corners concentric.
 */
export function SettingsGroup({
  title,
  description,
  titleId,
  descriptionId,
  children,
}: SettingsGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      {title ? (
        // deslop-ignore-next-line 12 — grouped-list caption, not a page heading
        <h3
          id={titleId}
          className="px-1 text-xs font-semibold text-muted-foreground"
        >
          {title}
        </h3>
      ) : null}
      <div
        role="group"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      >
        {children}
      </div>
      {description ? (
        <p
          id={descriptionId}
          className="px-1 text-xs text-pretty text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

export interface SettingsRowProps {
  readonly label: string;
  readonly description?: string;
  /**
   * Binds the label to a control the caller renders as `children`. Set it for
   * a switch, so the text both names the control and toggles it; leave it off
   * for a select or an input, whose own element carries the name.
   */
  readonly labelFor?: string;
  /** Id given to the description so a control can reference it. */
  readonly descriptionId?: string;
  /** Current value, printed left of the control. */
  readonly value?: string;
  readonly children?: ReactNode;
}

/**
 * One setting on a single line: text stack leading, control trailing, 44px
 * minimum.
 *
 * The row itself is never the click target. A select, input or button owns its
 * own target, and wrapping the row in a second focusable would make the
 * control appear to take focus twice.
 */
export function SettingsRow({
  label,
  description,
  labelFor,
  descriptionId,
  value,
  children,
}: SettingsRowProps) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
      {/* The label covers the whole text stack and the row's full height, so
          the pointer target for a trailing switch is the row rather than the
          28px pill, and the description is part of what activates it. */}
      {labelFor ? (
        <label
          htmlFor={labelFor}
          className="flex min-h-10 min-w-0 cursor-pointer flex-col justify-center gap-0.5 text-sm font-medium"
        >
          {label}
          {/* Hidden from the name computation so the control is still called
              "Count muted chats" rather than the label plus its whole
              explanation; `aria-describedby` still reads it by id. */}
          {description ? (
            <span
              id={descriptionId}
              aria-hidden="true"
              className="text-xs font-normal text-pretty text-muted-foreground"
            >
              {description}
            </span>
          ) : null}
        </label>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {description ? (
            <p
              id={descriptionId}
              className="text-xs text-pretty text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-3">
        {value ? (
          <span className="text-sm tabular-nums text-muted-foreground">
            {value}
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export interface SettingsStackedRowProps {
  readonly label: string;
  readonly description?: string;
  /** Current value, printed opposite the label. */
  readonly value?: string;
  readonly children: ReactNode;
}

/**
 * Row whose control needs the full width - a slider, a horizontal radio set or
 * a text field. Squeezing those into the trailing column would leave a target
 * too narrow to aim at, so the label sits above instead of beside.
 */
export function SettingsStackedRow({
  label,
  description,
  value,
  children,
}: SettingsStackedRowProps) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{label}</span>
        {value ? (
          <span className="text-sm tabular-nums text-muted-foreground">
            {value}
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export interface SettingsLinkRowProps {
  readonly label: string;
  readonly description?: string;
  readonly value?: string;
  onClick(): void;
}

/**
 * Row that opens the next level. The whole row is the target and it carries a
 * chevron, which promises navigation - unlike a trailing control, which
 * promises a change in place.
 */
export function SettingsLinkRow({
  label,
  description,
  value,
  onClick,
}: SettingsLinkRowProps) {
  return (
    <PressableBlock
      aria-label={description ? `${label}, ${description}` : label}
      className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors hover:bg-muted"
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description ? (
          <span className="text-xs text-pretty text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {value ? (
          <span className="text-sm text-muted-foreground">{value}</span>
        ) : null}
        <CaretRight
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </span>
    </PressableBlock>
  );
}
