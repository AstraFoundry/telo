import { MagnifyingGlass } from "@phosphor-icons/react";

import { copy } from "shared/config/copy";
import { Input } from "shared/ui";

interface ChatSearchProps {
  value: string;
  onChange(value: string): void;
}

export function ChatSearch({ value, onChange }: ChatSearchProps) {
  return (
    <Input
      value={value}
      onChange={onChange}
      aria-label={copy.searchChats}
      placeholder={copy.searchChats}
      leftIcon={<MagnifyingGlass />}
      /* deslop-ignore-next-line 21 — rounded search field on a flat toolbar, no nesting parent */
      classNames={{ field: "h-9 rounded-xl bg-muted/55 border-transparent" }}
    />
  );
}
