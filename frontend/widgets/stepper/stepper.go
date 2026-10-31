// Package stepper draws onboarding progress as dots that stretch into a
// pill for the current step, as Arion's onboarding does.
package stepper

import (
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Render draws total+1 dots with index current active.
func Render(c *ui.Context, t theme.Tokens, current, total int) {
	ui.Row(c).Gap(6).AlignItems(ui.Center).Label(copy.F(copy.OnbStep, current+1, total+1)).Children(func() {
		for i := 0; i <= total; i++ {
			dot := ui.Box(c.Key(i)).Height(6).Radius(3)
			width := float32(6)
			color := t.CardBorder
			switch {
			case i == current:
				width, color = 22, t.Text
			case i < current:
				color = t.Faint
			}
			dot.Width(dot.AnimateTo("w", width, t.Motion(theme.Settle))).Background(dot.AnimateColor("c", color, theme.Quick))
		}
	})
}
