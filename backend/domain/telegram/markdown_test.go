package telegram

import (
	"reflect"
	"testing"
)

func TestParseMarkdown(t *testing.T) {
	cases := []struct {
		in   string
		out  string
		ents []Entity
	}{
		{"plain", "plain", nil},
		{"a **bold** b", "a bold b", []Entity{{Type: EntityBold, Offset: 2, Length: 4}}},
		{"__it__ and ~~gone~~", "it and gone", []Entity{{Type: EntityItalic, Offset: 0, Length: 2}, {Type: EntityStrikethrough, Offset: 7, Length: 4}}},
		{"run `go test` now", "run go test now", []Entity{{Type: EntityCode, Offset: 4, Length: 7}}},
		{"||secret||", "secret", []Entity{{Type: EntitySpoiler, Offset: 0, Length: 6}}},
		{"see [docs](https://core.telegram.org)", "see docs", []Entity{{Type: EntityTextLink, Offset: 4, Length: 4, URL: "https://core.telegram.org"}}},
		{"```go\nfmt.Println()```", "fmt.Println()", []Entity{{Type: EntityPre, Offset: 0, Length: 13, Language: "go"}}},
		{"**bold __both__**", "bold both", []Entity{{Type: EntityItalic, Offset: 5, Length: 4}, {Type: EntityBold, Offset: 0, Length: 9}}},
		{"2 ** 3 and a ** b", "2 ** 3 and a ** b", nil},
		{"**unclosed", "**unclosed", nil},
		{"`**not bold**`", "**not bold**", []Entity{{Type: EntityCode, Offset: 0, Length: 12}}},
		{"[x](javascript:alert)", "[x](javascript:alert)", nil},
		{"😀 **b**", "😀 b", []Entity{{Type: EntityBold, Offset: 3, Length: 1}}},
	}
	for _, c := range cases {
		out, ents := ParseMarkdown(c.in, nil)
		if out != c.out || !reflect.DeepEqual(ents, c.ents) {
			t.Errorf("ParseMarkdown(%q) = %q %+v, want %q %+v", c.in, out, ents, c.out, c.ents)
		}
	}
}

func TestParseMarkdownShiftsExistingEntities(t *testing.T) {
	out, ents := ParseMarkdown("**a** under", []Entity{{Type: EntityUnderline, Offset: 6, Length: 5}})
	if out != "a under" {
		t.Fatal(out)
	}
	want := []Entity{{Type: EntityBold, Offset: 0, Length: 1}, {Type: EntityUnderline, Offset: 2, Length: 5}}
	if !reflect.DeepEqual(ents, want) {
		t.Fatalf("%+v", ents)
	}
}
