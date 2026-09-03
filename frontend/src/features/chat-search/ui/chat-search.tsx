import { MagnifyingGlass } from "@phosphor-icons/react";
import type { FocusEvent } from "react";

import { copy } from "shared/config/copy";
import { Input } from "shared/ui";

interface ChatSearchProps {
  value: string;
  onChange(value: string): void;
  /**
   * Focus tracking drives the search-history surface: the list area swaps to
   * recent searches while the field is focused and empty, exactly when both
   * reference clients show theirs.
   */
  onFocus?(event: FocusEvent<HTMLInputElement>): void;
  onBlur?(event: FocusEvent<HTMLInputElement>): void;
}

export function ChatSearch({
  value,
  onChange,
  onFocus,
  onBlur,
}: ChatSearchProps) {
  return (
    <Input
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={copy.searchChats}
      placeholder={copy.searchChats}
      leftIcon={<MagnifyingGlass />}
      /* deslop-ignore-next-line 21 — rounded search field on a flat toolbar, no nesting parent */
      classNames={{ field: "h-10 rounded-xl bg-muted/55 border-transparent" }}
    />
  );
}
