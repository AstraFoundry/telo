# UI assets

| File | Source | Regenerate |
| --- | --- | --- |
| `mark.png` | The app icon, `build/icons/128x128.png` | `cp build/icons/128x128.png frontend/shared/assets/mark.png` |
| `backdrop.jpg` | Rendered by `cmd/teloart`: a deterministic, motion-blurred field of cool light in Telo's palette, the ground of the onboarding and About illustrations. Generated, so it carries no third-party license | `go run ./cmd/teloart -out frontend/shared/assets/backdrop.jpg` |

Backdrops must already be soft (blurred, low detail) so the mock UI drawn over them stays the subject, as in Arion's illustrations. Keep each under 200 KB.
