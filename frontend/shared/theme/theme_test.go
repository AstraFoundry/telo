package theme

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestReduceMotionFades(t *testing.T) {
	enter := &ui.Motion{X: 24, Scale: 0.9, Opacity: 0.2}
	moving := Tokens{}.Transition(Settle, enter, nil)
	if moving.Animation.Spring != Settle.Spring || moving.Enter != enter || moving.Exit != nil {
		t.Fatalf("moving transition %+v", moving)
	}
	still := Tokens{Still: true}.Transition(Settle, enter, nil)
	if still.Animation.Duration != Quick.Duration || still.Animation.Spring != (ui.SpringOptions{}) || *still.Enter != (ui.Motion{Opacity: 0.2}) || still.Exit != nil {
		t.Fatalf("still transition %+v", still)
	}
	if (Tokens{Still: true}).Motion(Pop).Duration != Quick.Duration || (Tokens{}).Motion(Pop).Spring != Pop.Spring {
		t.Fatal("Motion ignores the preference")
	}
}
