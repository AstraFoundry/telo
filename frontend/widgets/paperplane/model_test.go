package paperplane

import (
	"math"
	"testing"
	"time"
)

func TestFoldSequence(t *testing.T) {
	if n := len(facets); n < 10 || n > 64 {
		t.Fatalf("%d facets", n)
	}
	for s := 0.0; s <= Stages; s += 0.05 {
		ps := PoseAt(s)
		for _, f := range ps.Faces {
			for _, p := range f.Pts {
				if math.IsNaN(p.x+p.y+p.z) || p.z < -1e-6 {
					t.Fatalf("s=%.2f bad point %+v", s, p)
				}
			}
		}
	}
	flat := PoseAt(0)
	if w := flat.At(SheetW/2, 0).sub(flat.At(-SheetW/2, 0)).length(); math.Abs(w-SheetW) > 1e-6 {
		t.Fatalf("flat width %v", w)
	}
	// Each stage ends with its hinge at its full angle.
	for st, want := range map[int]float64{1: cornerFold, 2: edgeFold, 3: halfFold, 4: wingFold, 5: wingFold} {
		if got := PoseAt(float64(st)).FoldAngle(); math.Abs(got-want) > 1e-6 {
			t.Fatalf("stage %d angle %v, want %v", st, got, want)
		}
	}
	plane := PoseAt(Stages)
	l, r := plane.At(-SheetW/2, 0), plane.At(SheetW/2, 0)
	if math.Abs(l.x+r.x) > 1e-6 || math.Abs(l.z-r.z) > 1e-6 {
		t.Fatalf("plane not symmetric: %+v %+v", l, r)
	}
	t.Logf("facets %d, span %.1f, wing tip z %.1f, keel z %.1f", len(facets), r.x-l.x, l.z, plane.At(0, 0).z)
}

// TestEveryStepMovesTheCamera holds the figure to its brief: each step
// makes one more fold and shows it from a new viewpoint.
func TestEveryStepMovesTheCamera(t *testing.T) {
	for st := 1; st <= Stages; st++ {
		a, b := CameraAt(float64(st-1)), CameraAt(float64(st))
		if a == b {
			t.Fatalf("stage %d keeps the camera of stage %d", st, st-1)
		}
		before, after := PoseAt(float64(st-1)), PoseAt(float64(st))
		moved := false
		for i := range before.Faces {
			for j := range before.Faces[i].Pts {
				if before.Faces[i].Pts[j].sub(after.Faces[i].Pts[j]).length() > 1 {
					moved = true
				}
			}
		}
		if !moved {
			t.Fatalf("stage %d folds nothing", st)
		}
		if Active(float64(st)-0.5) != st {
			t.Fatalf("the fold of stage %d is not active during it", st)
		}
	}
}

// TestMarksMeasureTheModel checks the drawing's numbers against the
// paper: the sheet, the corner and edge folds, the keel.
func TestMarksMeasureTheModel(t *testing.T) {
	want := map[int]map[MarkKind][]float64{
		0: {Dim: {SheetW, SheetL}},
		1: {Arc: {45, 45}, Dim: {SheetW / math.Sqrt2}},
		2: {Arc: {22.5, 22.5}, Dim: {edgeY}},
		4: {Dim: {Keel}},
	}
	for stage, kinds := range want {
		got := map[MarkKind][]float64{}
		for _, m := range PoseAt(float64(stage)).Marks() {
			if m.Stage == stage && (m.Kind == Dim || m.Kind == Arc) {
				got[m.Kind] = append(got[m.Kind], m.Value)
			}
		}
		for kind, values := range kinds {
			if len(got[kind]) < len(values) {
				t.Fatalf("stage %d: marks %v, want %v", stage, got[kind], values)
			}
			for i, v := range values {
				if math.Abs(got[kind][i]-v) > 0.05 {
					t.Fatalf("stage %d mark %d reads %.2f, want %.2f", stage, i, got[kind][i], v)
				}
			}
		}
	}
}

// TestReducedMotionJumps checks that, with Reduce motion on, a step lands
// at once instead of tweening.
func TestReducedMotionJumps(t *testing.T) {
	now := time.Now()
	f := &Figure{}
	f.head(now, 0, true)
	f.head(now, 3, true)
	if v := f.value(now); v != 3 {
		t.Fatalf("still figure at %v, want 3", v)
	}
	f.head(now, 4, false)
	if v := f.value(now.Add(perStage / 2)); v <= 3 || v >= 4 {
		t.Fatalf("moving figure at %v halfway", v)
	}
}
