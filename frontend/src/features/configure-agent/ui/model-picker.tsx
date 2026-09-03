import { useState } from "react";

import type { AgentModelDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "shared/ui";

interface ModelPickerProps {
  readonly value: string;
  readonly models: ReadonlyArray<AgentModelDto>;
  onValueChange(value: string): void;
}

function uniqueIds(
  value: string,
  models: ReadonlyArray<AgentModelDto>,
  typed: string,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(value);
  for (const model of models) add(model.id);
  add(typed);
  return ids;
}

/**
 * Searchable model field. Options come from the vendor list; the current id
 * stays selectable even when the vendor omitted it, and a typed id that is
 * not in the list can still be saved.
 */
export function ModelPicker({
  value,
  models,
  onValueChange,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const ids = uniqueIds(value, models, typed);
  const labelFor = (id: string) =>
    models.find((model) => model.id === id)?.label ?? id;

  return (
    <Combobox
      className="w-full"
      value={value}
      onValueChange={onValueChange}
      onQueryChange={(next) => {
        setQuery(next);
        const trimmed = next.trim();
        if (trimmed) onValueChange(trimmed);
      }}
    >
      <ComboboxTrigger>
        <ComboboxInput aria-label={copy.model} placeholder={copy.searchModel} />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>{copy.noModelFound}</ComboboxEmpty>
          <ComboboxGroup>
            {ids.map((id) => (
              <ComboboxItem key={id} value={id} textValue={labelFor(id)}>
                {labelFor(id)}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
