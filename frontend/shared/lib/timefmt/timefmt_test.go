package timefmt

import (
	"strings"
	"testing"
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
)

func TestFormats(t *testing.T) {
	now := time.Date(2026, 8, 27, 16, 0, 0, 0, time.UTC)
	f := Formats{Locale: "en-US", Hours: preferences.Time24h}
	if got := f.Clock(now.Add(-3 * time.Hour)); got != "13:00" {
		t.Errorf("24h clock %q", got)
	}
	f.Hours = preferences.Time12h
	if got := f.Clock(now.Add(-3 * time.Hour)); !strings.HasPrefix(got, "1:00") || !strings.HasSuffix(got, "PM") {
		t.Errorf("12h clock %q", got)
	}
	cases := map[time.Duration]string{2 * 24 * time.Hour: "Tue", 30 * 24 * time.Hour: "Jul 28", 400 * 24 * time.Hour: "7/23/2025"}
	for d, want := range cases {
		if got := f.ListTime(now.Add(-d), now); got != want {
			t.Errorf("ListTime(-%v) = %q, want %q", d, got, want)
		}
	}
	if got := f.Day(now.Add(-time.Hour), now); got != "Today" {
		t.Error(got)
	}
	if got := f.Day(now.Add(-24*time.Hour), now); got != "Yesterday" {
		t.Error(got)
	}
	if got := f.Day(now.Add(-3*24*time.Hour), now); got != "Monday, August 24" {
		t.Errorf("day %q", got)
	}
	if got := f.Ago(now.Add(-5*time.Minute), now); got != "5 min ago" {
		t.Error(got)
	}
}
