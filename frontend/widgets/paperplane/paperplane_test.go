package paperplane

import (
	"fmt"
	"testing"
	"time"

	"github.com/AstraFoundry/telo/backend/domain/preferences"
	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/testkit"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// TestFiguresEveryStage folds the sheet through the flow in both themes,
// resting on every stage and halfway through every fold.
func TestFiguresEveryStage(t *testing.T) {
	for _, appearance := range []preferences.Theme{preferences.ThemeLight, preferences.ThemeDark} {
		fig := &Figure{}
		stage := 0
		view := func(c *ui.Context) {
			prefs := preferences.Default()
			prefs.Theme = appearance
			tok := theme.Apply(c, prefs)
			ui.Box(c).Width(320).Height(560).Children(func() { fig.Render(c, tok, stage, 40) })
		}
		tt := ui.NewTester(view, 320, 560)
		tt.Frame()
		if !tt.HasText(copy.T(copy.PlanLabel)) && len(tt.Texts()) > 0 {
			t.Logf("texts %q", tt.Texts())
		}
		testkit.Snapshot(t, tt, fmt.Sprintf("plane-%s-0", appearance))
		for stage = 1; stage <= Stages; stage++ {
			tt.Frame()
			tt.Advance(time.Duration(float64(perStage) * 0.45))
			testkit.Snapshot(t, tt, fmt.Sprintf("plane-%s-%d-mid", appearance, stage))
			tt.Advance(2 * perStage)
			if got := fig.value(time.Now().Add(time.Hour)); got != float64(stage) {
				t.Fatalf("stage %d: figure rests at %v", stage, got)
			}
			testkit.Snapshot(t, tt, fmt.Sprintf("plane-%s-%d", appearance, stage))
		}
	}
}
