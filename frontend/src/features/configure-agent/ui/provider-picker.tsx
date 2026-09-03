import type { AgentProvider } from "../../../../../contracts/src/ipc";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from "shared/ui";
import { copy } from "shared/config/copy";

import {
  AGENT_PROVIDER_KEYWORDS,
  AGENT_PROVIDER_LABEL,
  NAMED_AGENT_PROVIDERS,
} from "../lib/providers";

interface ProviderPickerProps {
  readonly value: AgentProvider;
  onValueChange(value: AgentProvider): void;
}

/**
 * Searchable BYOA provider picker. Named accounts sit above the
 * OpenAI-compatible fallback; the panel is portaled so it is not clipped by
 * the settings card.
 */
export function ProviderPicker({ value, onValueChange }: ProviderPickerProps) {
  return (
    <Combobox
      className="w-full"
      value={value}
      onValueChange={(next) => onValueChange(next as AgentProvider)}
    >
      <ComboboxTrigger>
        <ComboboxInput
          aria-label={copy.provider}
          placeholder={copy.searchProvider}
        />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList ariaLabel={copy.provider}>
          <ComboboxEmpty>{copy.noProviderFound}</ComboboxEmpty>
          <ComboboxGroup>
            {NAMED_AGENT_PROVIDERS.map((id) => (
              <ComboboxItem
                key={id}
                value={id}
                textValue={AGENT_PROVIDER_LABEL[id]}
                keywords={[...AGENT_PROVIDER_KEYWORDS[id]]}
              >
                {AGENT_PROVIDER_LABEL[id]}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
          <ComboboxSeparator />
          <ComboboxGroup>
            <ComboboxItem
              value="openai-compatible"
              textValue={AGENT_PROVIDER_LABEL["openai-compatible"]}
              keywords={[...AGENT_PROVIDER_KEYWORDS["openai-compatible"]]}
            >
              {AGENT_PROVIDER_LABEL["openai-compatible"]}
            </ComboboxItem>
          </ComboboxGroup>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
