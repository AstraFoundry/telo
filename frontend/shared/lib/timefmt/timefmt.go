// Package timefmt writes the dates and times of the chat list, the
// transcript and the profile panel in the user's regional formats, with
// the 12- or 24-hour clock the settings choose.
package timefmt

import (
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/egoist/mygo/i18n"
)

// Formats is the locale and clock to write with.
type Formats struct {
	// Locale is the regional formats' locale ("en-GB-u-hc-h23").
	Locale string
	Hours  preferences.TimeFormat
}

func (f Formats) locale() string {
	if f.Locale == "" {
		return "en"
	}
	return f.Locale
}

func (f Formats) hourCycle() int {
	switch f.Hours {
	case preferences.Time12h:
		return 12
	case preferences.Time24h:
		return 24
	}
	return 0
}

// Clock writes a time of day: 13:07 or 1:07 PM.
func (f Formats) Clock(t time.Time) string {
	return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "jm", HourCycle: f.hourCycle()})
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

// ListTime writes a chat row's time: the clock today, the weekday this
// week, the date otherwise, with the year only when it differs.
func (f Formats) ListTime(t, now time.Time) string {
	switch {
	case t.IsZero():
		return ""
	case sameDay(t, now):
		return f.Clock(t)
	case now.Sub(t) < 6*24*time.Hour && t.Before(now):
		return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "EEE"})
	case t.Year() == now.Year():
		return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "MMMd"})
	}
	return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "yMd"})
}

// Day writes a transcript's day separator: Today, Yesterday, or the date.
func (f Formats) Day(t, now time.Time) string {
	switch {
	case sameDay(t, now):
		return copy.T(copy.Today)
	case sameDay(t, now.AddDate(0, 0, -1)):
		return copy.T(copy.Yesterday)
	case t.Year() == now.Year():
		return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "MMMMEEEEd"})
	}
	return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "yMMMMd"})
}

// Full writes a date and time, for message info and sessions.
func (f Formats) Full(t time.Time) string {
	return i18n.FormatDate(f.locale(), t, i18n.DateOptions{Skeleton: "yMMMdjm", HourCycle: f.hourCycle()})
}

// Ago writes how long ago something happened: just now, 5 min ago, 3 h
// ago, or the list time.
func (f Formats) Ago(t, now time.Time) string {
	d := now.Sub(t)
	switch {
	case d < time.Minute:
		return copy.T(copy.JustNow)
	case d < time.Hour:
		return copy.F(copy.MinutesAgo, int(d/time.Minute))
	case d < 12*time.Hour:
		return copy.F(copy.HoursAgo, int(d/time.Hour))
	}
	return f.ListTime(t, now)
}
