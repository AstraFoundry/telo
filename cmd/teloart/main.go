// Command teloart renders Telo's illustration backdrop: a soft, motion-
// blurred field of cool light, the photograph-like ground the onboarding
// and About illustrations float their mock UI on. It is generated rather
// than photographed so its palette is Telo's own and it carries no
// third-party license; the output is deterministic.
//
//	go run ./cmd/teloart -out frontend/shared/assets/backdrop.jpg
package main

import (
	"flag"
	"image"
	"image/color"
	"image/jpeg"
	"log"
	"math"
	"math/rand"
	"os"
)

type rgb struct{ r, g, b float64 }

func (a rgb) add(b rgb, k float64) rgb { return rgb{a.r + b.r*k, a.g + b.g*k, a.b + b.b*k} }

func mix(a, b rgb, t float64) rgb {
	return rgb{a.r + (b.r-a.r)*t, a.g + (b.g-a.g)*t, a.b + (b.b-a.b)*t}
}

func hex(v uint32) rgb {
	return rgb{float64(v>>16&0xff) / 255, float64(v>>8&0xff) / 255, float64(v&0xff) / 255}
}

func main() {
	out := flag.String("out", "frontend/shared/assets/backdrop.jpg", "output JPEG")
	w := flag.Int("w", 800, "width")
	h := flag.Int("h", 1000, "height")
	flag.Parse()
	rng := rand.New(rand.NewSource(20261029))
	px := make([]rgb, *w**h)
	top, bottom := hex(0x0d2a4a), hex(0x1d6f8f)
	glow := hex(0xf4c9a8)
	for y := 0; y < *h; y++ {
		for x := 0; x < *w; x++ {
			t := float64(y) / float64(*h)
			c := mix(top, bottom, t)
			// A warm dawn band low on the frame, as light through glass.
			band := math.Exp(-math.Pow((t-0.72)/0.16, 2)) * 0.55
			c = mix(c, glow, band*(0.6+0.4*math.Sin(float64(x)/float64(*w)*math.Pi)))
			px[y**w+x] = c
		}
	}
	// Bokeh: soft discs of light in Telo's blues and a few warm ones.
	palette := []rgb{hex(0x5fb3ff), hex(0x8fd3ff), hex(0x2a7de1), hex(0xb7e4ff), hex(0xffd7b0), hex(0x6be0d0)}
	for i := 0; i < 70; i++ {
		cx, cy := rng.Float64()*float64(*w), rng.Float64()*float64(*h)
		radius := 20 + rng.Float64()*110
		col := palette[rng.Intn(len(palette))]
		strength := 0.12 + rng.Float64()*0.35
		x0, x1 := int(math.Max(0, cx-radius*2)), int(math.Min(float64(*w-1), cx+radius*2))
		y0, y1 := int(math.Max(0, cy-radius*2)), int(math.Min(float64(*h-1), cy+radius*2))
		for y := y0; y <= y1; y++ {
			for x := x0; x <= x1; x++ {
				d := math.Hypot(float64(x)-cx, float64(y)-cy) / radius
				// A disc with a soft rim, as an out-of-focus highlight.
				k := strength * (1 / (1 + math.Exp((d-1)*9))) * (0.75 + 0.25*d)
				px[y**w+x] = px[y**w+x].add(col, k*0.55)
			}
		}
	}
	// Motion blur: a long horizontal smear, then a short vertical one.
	px = blur(px, *w, *h, 26, 0)
	px = blur(px, *w, *h, 26, 0)
	px = blur(px, *w, *h, 0, 6)
	img := image.NewRGBA(image.Rect(0, 0, *w, *h))
	for y := 0; y < *h; y++ {
		for x := 0; x < *w; x++ {
			c := px[y**w+x]
			n := (rng.Float64() - 0.5) * 0.025 // film grain
			img.SetRGBA(x, y, color.RGBA{clamp(c.r + n), clamp(c.g + n), clamp(c.b + n), 255})
		}
	}
	f, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 78}); err != nil {
		log.Fatal(err)
	}
}

func clamp(v float64) uint8 {
	return uint8(math.Max(0, math.Min(255, math.Round(v*255))))
}

// blur is a box blur of radius rx horizontally and ry vertically.
func blur(src []rgb, w, h, rx, ry int) []rgb {
	dst := make([]rgb, len(src))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var s rgb
			n := 0.0
			for dy := -ry; dy <= ry; dy++ {
				yy := min(h-1, max(0, y+dy))
				for dx := -rx; dx <= rx; dx++ {
					xx := min(w-1, max(0, x+dx))
					s = s.add(src[yy*w+xx], 1)
					n++
				}
			}
			dst[y*w+x] = rgb{s.r / n, s.g / n, s.b / n}
		}
	}
	return dst
}
