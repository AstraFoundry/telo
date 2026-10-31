package demo

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	tg "github.com/AstraFoundry/telo/backend/domain/telegram"
)

// assets synthesizes the demo's files on demand into a cache directory:
// photos are soft gradients, stickers flat discs, a document a stub PDF.
// Files only exist once "downloaded", so the transcript's download path
// runs as with TDLib.
type assets struct {
	dir   string
	mu    sync.Mutex
	next  tg.FileID
	files map[tg.FileID]asset
}

type asset struct {
	name  string
	write func() ([]byte, error)
	size  int64
}

func newAssets(dir string) *assets {
	return &assets{dir: dir, next: 100, files: map[tg.FileID]asset{}}
}

func (a *assets) add(name string, size int64, write func() ([]byte, error)) tg.FileID {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.next++
	a.files[a.next] = asset{name: name, write: write, size: size}
	return a.next
}

// materialize writes a file and returns its path.
func (a *assets) materialize(id tg.FileID) (string, int64, error) {
	a.mu.Lock()
	f, ok := a.files[id]
	a.mu.Unlock()
	if !ok {
		return "", 0, tg.ErrNotFound
	}
	path := filepath.Join(a.dir, fmt.Sprintf("%d-%s", id, f.name))
	if _, err := os.Stat(path); err == nil {
		return path, f.size, nil
	}
	data, err := f.write()
	if err != nil {
		return "", 0, err
	}
	if err := os.MkdirAll(a.dir, 0o700); err != nil {
		return "", 0, err
	}
	return path, int64(len(data)), os.WriteFile(path, data, 0o600)
}

// palettes tint each generated photo differently.
var palettes = [][2]color.RGBA{
	{{0x2b, 0x5b, 0x84, 255}, {0xf2, 0xa9, 0x6b, 255}},
	{{0x1f, 0x6f, 0x5c, 255}, {0xe8, 0xd5, 0x8c, 255}},
	{{0x5b, 0x3f, 0x8c, 255}, {0xf0, 0x8a, 0x9b, 255}},
	{{0x8c, 0x3f, 0x2b, 255}, {0xf5, 0xd0, 0x8a, 255}},
}

func gradient(w, h, variant int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	p := palettes[variant%len(palettes)]
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := (float64(x)/float64(w) + float64(y)/float64(h)) / 2
			wave := 0.08 * math.Sin(float64(x)/37+float64(y)/53+float64(variant))
			t = math.Max(0, math.Min(1, t+wave))
			img.SetRGBA(x, y, color.RGBA{
				uint8(float64(p[0].R)*(1-t) + float64(p[1].R)*t),
				uint8(float64(p[0].G)*(1-t) + float64(p[1].G)*t),
				uint8(float64(p[0].B)*(1-t) + float64(p[1].B)*t), 255})
		}
	}
	return img
}

func encodePNG(img image.Image) ([]byte, error) {
	var b bytes.Buffer
	err := png.Encode(&b, img)
	return b.Bytes(), err
}

// minithumbnail is a tiny JPEG of the photo, as TDLib's blurred preview.
func minithumbnail(variant int) []byte {
	var b bytes.Buffer
	_ = jpeg.Encode(&b, gradient(8, 6, variant), &jpeg.Options{Quality: 60})
	return b.Bytes()
}

func (a *assets) photo(name string, w, h, variant int) *tg.Media {
	id := a.add(name, int64(w*h), func() ([]byte, error) { return encodePNG(gradient(w, h, variant)) })
	return &tg.Media{Kind: tg.MediaPhoto, FileID: id, FileName: name, MIMEType: "image/png", Width: w, Height: h, Minithumbnail: minithumbnail(variant)}
}

func (a *assets) document(name, mime string, size int64) *tg.Media {
	id := a.add(name, size, func() ([]byte, error) {
		return []byte("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), nil
	})
	return &tg.Media{Kind: tg.MediaFile, FileID: id, FileName: name, MIMEType: mime, Size: size}
}

func (a *assets) voice(d time.Duration) *tg.Media {
	id := a.add("voice.ogg", 22_400, func() ([]byte, error) { return []byte("OggS"), nil })
	wave := make([]byte, 63)
	for i := range wave {
		wave[i] = byte(31 * (0.5 + 0.5*math.Sin(float64(i)/3)))
	}
	return &tg.Media{Kind: tg.MediaVoice, FileID: id, MIMEType: "audio/ogg", Duration: d, Waveform: wave, Size: 22_400}
}

// stickerColors tint the generated sticker discs by emoji.
var stickerColors = map[string]color.RGBA{"👋": {0xf5, 0xb8, 0x41, 255}, "🎉": {0xe5, 0x5b, 0x7b, 255}, "🔥": {0xf0, 0x6a, 0x2b, 255}, "👍": {0x4f, 0x9d, 0xe8, 255}, "❤️": {0xe0, 0x3f, 0x4f, 255}}

func disc(c color.RGBA) *image.RGBA {
	const n = 256
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			dx, dy := float64(x)-n/2+0.5, float64(y)-n/2+0.5
			r := math.Hypot(dx, dy)
			if r < n/2-4 {
				shade := 1 - 0.25*(dy/(n/2))
				img.SetRGBA(x, y, color.RGBA{uint8(math.Min(255, float64(c.R)*shade)), uint8(math.Min(255, float64(c.G)*shade)), uint8(math.Min(255, float64(c.B)*shade)), 255})
			}
		}
	}
	return img
}

func (a *assets) stickerFile(emoji string) (tg.FileID, func() ([]byte, error)) {
	c, ok := stickerColors[emoji]
	if !ok {
		c = color.RGBA{0x8a, 0x8f, 0xa3, 255}
	}
	write := func() ([]byte, error) { return encodePNG(disc(c)) }
	return a.add("sticker.png", 9000, write), write
}

func (a *assets) sticker(emoji string, format tg.StickerFormat) *tg.Media {
	id, _ := a.stickerFile(emoji)
	return &tg.Media{Kind: tg.MediaSticker, FileID: id, FileName: "sticker.png", MIMEType: "image/png", Width: 512, Height: 512,
		Sticker: &tg.MessageSticker{Emoji: emoji, Role: tg.RoleSticker, Format: format, SetID: demoStickerSet, OutlinePath: "M64,64L448,64L448,448L64,448z"}}
}

// stickerItem is a sticker of the demo pack.
func (a *assets) stickerItem(id int64, emoji string) tg.Sticker {
	file, _ := a.stickerFile(emoji)
	return tg.Sticker{ID: id, FileID: file, Emoji: emoji, Format: tg.StickerStatic, Width: 512, Height: 512, SetID: demoStickerSet}
}

const demoStickerSet int64 = 77001

// uploaded registers a file the user sent, readable from its path.
func (a *assets) uploaded(f tg.UploadFile) tg.FileID {
	return a.add(filepath.Base(f.Path), f.Size, func() ([]byte, error) { return os.ReadFile(f.Path) })
}
