import { COUNTRIES } from "shared/config/countries";
import { copy } from "shared/config/copy";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "shared/ui";

interface CountryComboboxProps {
  /** ISO 3166-1 alpha-2 code of the selected country. */
  value: string;
  onValueChange(code: string): void;
  disabled?: boolean;
}

/**
 * Searchable country/region picker for the phone sign-in, built on the beui
 * combobox. Items match on the country name and the dialing code, so both
 * "united" and "+44" find the United Kingdom.
 */
export function CountryCombobox({
  value,
  onValueChange,
  disabled = false,
}: CountryComboboxProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-sm font-medium text-foreground">
        {copy.countryOrRegion}
      </span>
      <Combobox value={value} onValueChange={onValueChange} disabled={disabled}>
        <ComboboxTrigger className="h-11 rounded-full px-3.5">
          <ComboboxInput
            aria-label={copy.countryOrRegion}
            placeholder={copy.searchCountryOrRegion}
          />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>{copy.noCountryOrRegionFound}</ComboboxEmpty>
            {COUNTRIES.map((country) => (
              <ComboboxItem
                key={country.code}
                value={country.code}
                textValue={country.name}
                keywords={[country.dialCode, `+${country.dialCode}`]}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="w-6 shrink-0 text-center text-lg leading-none"
                  >
                    {country.flag}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {country.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    +{country.dialCode}
                  </span>
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
