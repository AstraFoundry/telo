// Package assets embeds the interface's pictures; README.md records where
// each comes from and how to regenerate it.
package assets

import (
	_ "embed"

	"github.com/egoist/mygo/ui"
)

var (
	//go:embed mark.png
	markPNG []byte
)

// Mark is the app icon.
var Mark = mustDecode(markPNG)

func mustDecode(data []byte) *ui.Bitmap {
	b, err := ui.DecodeBitmap(data)
	if err != nil {
		panic(err)
	}
	return b
}
