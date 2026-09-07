import {
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js/min";
import metadata from "libphonenumber-js/metadata.min.json";

/**
 * Country/region options for the phone sign-in. Names come from the platform
 * (`Intl.DisplayNames`) and dialing codes from libphonenumber-js metadata —
 * the same underlying dataset Telegram clients use via PhoneFormat.
 */

export interface Country {
  /** ISO 3166-1 alpha-2 code. */
  code: CountryCode;
  /** Unicode regional-indicator flag derived from the ISO code. */
  flag: string;
  /** English display name (project copy is English-only). */
  name: string;
  /** International dialing code without the leading "+". */
  dialCode: string;
}

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

export const COUNTRIES: readonly Country[] = getCountries()
  .map((code) => ({
    code,
    flag: countryFlag(code),
    name: displayNames.of(code) ?? code,
    dialCode: getCountryCallingCode(code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

/** Converts an ISO alpha-2 code into its Unicode flag sequence. */
function countryFlag(code: CountryCode): string {
  return [...code]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

const COUNTRY_BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((country) => [country.code, country]),
);

// libphonenumber's country_calling_codes lists the main territory for a
// shared dialing code first (1 → US, 7 → RU, 44 → GB), which is the sane
// default when a typed prefix cannot disambiguate further.
const MAIN_COUNTRY_BY_DIAL_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(metadata.country_calling_codes).map(([dialCode, codes]) => [
    dialCode,
    codes[0],
  ]),
);

export const DEFAULT_COUNTRY_CODE = "US";

/** Preselected country from the system locale, e.g. "en-US" → "US". */
export function detectCountryCode(languageTag: string): string {
  try {
    const region = new Intl.Locale(languageTag).maximize().region;
    if (region && COUNTRY_BY_CODE.has(region)) return region;
  } catch {
    // Not a well-formed language tag — fall through to the default.
  }
  return DEFAULT_COUNTRY_CODE;
}

export function getCountry(code: string): Country {
  return (
    COUNTRY_BY_CODE.get(code) ?? COUNTRY_BY_CODE.get(DEFAULT_COUNTRY_CODE)!
  );
}

export interface ParsedInternationalPhone {
  country: Country;
  /** National significant number — the digits after the dialing code. */
  nationalNumber: string;
}

/**
 * Splits raw input into a country and national number when it carries an
 * international "+" prefix, choosing the longest matching dialing code.
 * Returns null for input without a "+" prefix.
 */
export function parseInternationalPhone(
  raw: string,
): ParsedInternationalPhone | null {
  if (!raw.trimStart().startsWith("+")) return null;
  const digits = raw.replace(/\D/g, "");
  for (let length = Math.min(3, digits.length); length >= 1; length--) {
    const mainCode = MAIN_COUNTRY_BY_DIAL_CODE.get(digits.slice(0, length));
    const country = mainCode ? COUNTRY_BY_CODE.get(mainCode) : undefined;
    if (country) {
      return { country, nationalNumber: digits.slice(length) };
    }
  }
  return null;
}
