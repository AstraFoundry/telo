import {
  Code,
  EyeSlash,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { copy } from "shared/config/copy";
import { Button, Tooltip } from "shared/ui";

import {
  COMPOSER_FORMATS,
  type ComposerFormatType,
} from "../model/composer-entities";

const FORMAT_ICONS: Record<ComposerFormatType, ReactNode> = {
  bold: <TextB aria-hidden="true" className="size-4" />,
  italic: <TextItalic aria-hidden="true" className="size-4" />,
  underline: <TextUnderline aria-hidden="true" className="size-4" />,
  strikethrough: <TextStrikethrough aria-hidden="true" className="size-4" />,
  code: <Code aria-hidden="true" className="size-4" />,
  spoiler: <EyeSlash aria-hidden="true" className="size-4" />,
};

const FORMAT_LABELS: Record<ComposerFormatType, string> = {
  bold: copy.formatBold,
  italic: copy.formatItalic,
  underline: copy.formatUnderline,
  strikethrough: copy.formatStrikethrough,
  code: copy.formatCode,
  spoiler: copy.formatSpoiler,
};

export interface FormattingToolbarProps {
  readonly disabled?: boolean;
  readonly active: ReadonlySet<ComposerFormatType>;
  onToggle(type: ComposerFormatType): void;
}

/** Icon-only UTF-16 formatting controls for the composer draft. */
export function FormattingToolbar({
  disabled,
  active,
  onToggle,
}: FormattingToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={copy.formattingToolbar}
      className="flex flex-wrap items-center gap-0.5"
    >
      {COMPOSER_FORMATS.map((type) => {
        const label = FORMAT_LABELS[type];
        const pressed = active.has(type);
        return (
          <Tooltip key={type} content={label}>
            <Button
              type="button"
              size="icon"
              variant={pressed ? "secondary" : "ghost"}
              disabled={disabled}
              aria-label={label}
              aria-pressed={pressed}
              className="size-10 rounded-full"
              onClick={() => onToggle(type)}
            >
              {FORMAT_ICONS[type]}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}
