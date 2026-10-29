// Package config holds static data the views read: the country list of
// the phone sign-in and the keyboard shortcut registry.
package config

import (
	_ "embed"
	"strings"
)

// Country is a country or region of the phone sign-in.
type Country struct {
	// Code is ISO 3166-1 alpha-2.
	Code string
	Name string
	// Dial is the calling code without "+".
	Dial string
}

// Flag is the country's regional-indicator flag.
func (c Country) Flag() string {
	var b strings.Builder
	for _, r := range c.Code {
		b.WriteRune(0x1f1e6 + r - 'A')
	}
	return b.String()
}

// countries.tsv is generated from libphonenumber-js metadata (names from
// Intl.DisplayNames), the dataset Telegram's clients format numbers with.
//
//go:embed countries.tsv
var countriesTSV string

// Countries lists every country by English name.
var Countries = func() []Country {
	var out []Country
	for _, line := range strings.Split(strings.TrimSpace(countriesTSV), "\n") {
		f := strings.Split(line, "\t")
		if len(f) == 3 {
			out = append(out, Country{Code: f[0], Name: f[1], Dial: f[2]})
		}
	}
	return out
}()

// CountryByCode finds a country.
func CountryByCode(code string) (Country, bool) {
	for _, c := range Countries {
		if c.Code == code {
			return c, true
		}
	}
	return Country{}, false
}

// CountryForPhone picks the country whose calling code is the longest
// prefix of an international number's digits.
func CountryForPhone(digits string) (Country, bool) {
	var best Country
	for _, c := range Countries {
		if strings.HasPrefix(digits, c.Dial) && len(c.Dial) > len(best.Dial) {
			best = c
		}
	}
	return best, best.Code != ""
}
