package telegram

import (
	"reflect"
	"testing"
)

func TestIsolatedEmojiCount(t *testing.T) {
	cases := map[string]int{
		"👍": 1, "👍😀": 2, "👍😀🎉": 3,
		"👍🏽": 1, "🇬🇧": 1, "👨‍👩‍👧‍👦": 1, "❤️‍🔥": 1, "1️⃣": 1,
		"👍😀🎉🔥": 0,
		"👍!":   0, "ok 👍": 0, "👍 👍": 0, "hello": 0, "": 0,
		"1": 0, "#": 0, "123": 0,
	}
	for text, want := range cases {
		if got := IsolatedEmojiCount(text); got != want {
			t.Errorf("IsolatedEmojiCount(%q) = %d, want %d", text, got, want)
		}
	}
}

func TestTrimOutgoing(t *testing.T) {
	bold := []Entity{{Type: EntityBold, Offset: 0, Length: 5}}
	if body, ents := TrimOutgoing("hello", bold); body != "hello" || !reflect.DeepEqual(ents, bold) {
		t.Fatalf("no-op trim changed %q %v", body, ents)
	}
	body, ents := TrimOutgoing("  hello world  ", []Entity{{Type: EntityBold, Offset: 8, Length: 5}})
	if body != "hello world" || !reflect.DeepEqual(ents, []Entity{{Type: EntityBold, Offset: 6, Length: 5}}) {
		t.Fatalf("got %q %v", body, ents)
	}
	// 😀 is two UTF-16 units, so "bold" starts at 4 after the trim.
	body, ents = TrimOutgoing(" 😀 bold ", []Entity{{Type: EntityBold, Offset: 4, Length: 4}})
	if body != "😀 bold" || !reflect.DeepEqual(ents, []Entity{{Type: EntityBold, Offset: 3, Length: 4}}) {
		t.Fatalf("astral: got %q %v", body, ents)
	}
	body, ents = TrimOutgoing("  hi  ", []Entity{{Type: EntityItalic, Offset: 0, Length: 2}})
	if body != "hi" || len(ents) != 0 {
		t.Fatalf("edge-only span kept: %q %v", body, ents)
	}
}

func TestCanSend(t *testing.T) {
	textOnly := Chat{CanSendMessages: true}
	if !textOnly.CanSend(ContentText) || textOnly.CanSend(ContentStickers) || textOnly.CanSend(ContentMedia) || !textOnly.CanSend(ContentAny) {
		t.Fatal("text-only chat")
	}
	readOnly := Chat{}
	if readOnly.CanSend(ContentAny) {
		t.Fatal("read-only chat allows content")
	}
	if RequireSend(readOnly, ContentText) != ErrCannotWrite || RequireSend(textOnly, ContentStickers) != ErrCannotStickers || RequireSend(textOnly, ContentMedia) != ErrCannotMedia {
		t.Fatal("RequireSend errors")
	}
}

func TestInitials(t *testing.T) {
	cases := map[string]string{"Ada Lovelace": "AL", "ada": "A", "Grace Brewster Hopper": "GB", "🚀 Launch": "L", "🚀": "🚀", "": ""}
	for in, want := range cases {
		if got := Initials(in); got != want {
			t.Errorf("Initials(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUTF16(t *testing.T) {
	if UTF16Len("a😀b") != 4 {
		t.Fatal(UTF16Len("a😀b"))
	}
	if got := UTF16Slice("a😀bc", 1, 3); got != "😀" {
		t.Fatal(got)
	}
	ents := ValidEntities("abc", []Entity{{Offset: 0, Length: 3}, {Offset: 2, Length: 5}, {Offset: -1, Length: 1}})
	if len(ents) != 1 {
		t.Fatal(ents)
	}
}
