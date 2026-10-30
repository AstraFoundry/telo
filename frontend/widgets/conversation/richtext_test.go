package conversation

import (
	"testing"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

func TestSpans(t *testing.T) {
	body := "Ship 😀 bold link"
	spans := Spans(body, []tg.Entity{{Type: tg.EntityBold, Offset: 8, Length: 4}, {Type: tg.EntityTextLink, Offset: 13, Length: 4, URL: "https://telegram.org"}})
	var got []string
	for _, s := range spans {
		got = append(got, s.text)
	}
	if len(spans) != 4 || got[0] != "Ship 😀 " || got[1] != "bold" || !spans[1].bold || got[3] != "link" || spans[3].link != "https://telegram.org" {
		t.Fatalf("%q %+v", got, spans)
	}
	url := Spans("go example.com", []tg.Entity{{Type: tg.EntityURL, Offset: 3, Length: 11}})
	if url[1].link != "https://example.com" {
		t.Fatal(url[1].link)
	}
}
