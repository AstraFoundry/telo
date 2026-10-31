package paperplane

import (
	"math"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
)

// MarkKind is a kind of drawing mark.
type MarkKind int

const (
	// Dim is a dimension: extension lines from A and B out along Off, and
	// an arrowed line between them carrying the label.
	Dim MarkKind = iota
	// Arc is an angle at V from direction DirA to DirB, at radius R.
	Arc
	// Centre is a dash-dot centre line from A to B.
	Centre
	// Crease is a dash-dot line along the fold being made, from A to B.
	Crease
)

// Mark is one mark of the drawing, placed in the world at the pose, with
// the value its label states, measured from the same pose.
type Mark struct {
	Kind       MarkKind
	Stage      int
	A, B, Off  vec
	V          vec
	DirA, DirB vec
	R          float64
	// Far letters a centre line at B rather than A.
	Far   bool
	Label copy.Key
	Value float64
}

// Marks are the drawing's marks for every stage at the pose; the figure
// shows each stage's while the paper rests near that stage.
func (ps Pose) Marks() []Mark {
	at := ps.At
	var out []Mark
	dim := func(stage int, a, b, off vec, label copy.Key, value float64) {
		out = append(out, Mark{Kind: Dim, Stage: stage, A: a, B: b, Off: off, Label: label, Value: value})
	}
	arc := func(stage int, v, a, b vec, r float64, label copy.Key) {
		da, db := a.sub(v).unit(), b.sub(v).unit()
		out = append(out, Mark{Kind: Arc, Stage: stage, V: v, DirA: da, DirB: db, R: r, Label: label, Value: angleBetween(da, db)})
	}
	line := func(stage int, a, b vec, far bool) {
		out = append(out, Mark{Kind: Centre, Stage: stage, A: a, B: b, Far: far, Label: copy.PlanCentre})
	}
	hw, apex := SheetW/2, at(0, SheetL)

	// The sheet: its width, its length and its centre line.
	dim(0, at(-hw, 0), at(hw, 0), vec{0, -26, 0}, copy.PlanWidth, at(hw, 0).sub(at(-hw, 0)).length())
	dim(0, at(-hw, 0), at(-hw, SheetL), vec{-26, 0, 0}, copy.PlanLength, at(-hw, SheetL).sub(at(-hw, 0)).length())
	line(0, at(0, -14), at(0, SheetL+24), true)

	// The corners: 45° from the centre line, along a crease of W/√2.
	for _, side := range []float64{-1, 1} {
		end := at(side*hw, SheetL-hw)
		arc(1, apex, at(0, SheetL-80), end, 46, copy.PlanDegrees)
		out = append(out, Mark{Kind: Crease, Stage: 1, A: apex, B: end})
	}
	cr := at(-hw, SheetL-hw).sub(apex)
	dim(1, apex, at(-hw, SheetL-hw), vec{-cr.y, cr.x, 0}.unit().mul(-18), copy.PlanCrease, cr.length())
	line(1, at(0, -20), at(0, SheetL+10), false)

	// The edges: the bisector, 22.5°, meeting the side at edgeY.
	for _, side := range []float64{-1, 1} {
		end := at(side*hw, edgeY)
		arc(2, apex, at(0, SheetL-60), end, 58, copy.PlanDegrees)
		out = append(out, Mark{Kind: Crease, Stage: 2, A: apex, B: end})
	}
	dim(2, at(-hw, 0), at(-hw, edgeY), vec{-20, 0, 0}, copy.PlanRise, at(-hw, edgeY).sub(at(-hw, 0)).length())

	// In half: the angle the halves leave between them at the tail.
	tail := at(0, 0)
	arc(3, tail, at(-60, 0), at(60, 0), 30, copy.PlanDegrees)
	out = append(out, Mark{Kind: Crease, Stage: 3, A: tail, B: apex})

	// The wings: the keel's depth, and the angle the wing crease leaves.
	back := tail.sub(at(0, 40)).unit()
	for i, side := range []float64{-1, 1} {
		stage := 4 + i
		root := at(side*Keel, 0)
		out = append(out, Mark{Kind: Crease, Stage: stage, A: at(side*wingAt(250), 250), B: root})
		if stage == 4 {
			// The keel's depth behind the tail, and the angle between keel
			// and wing halfway along the crease.
			dim(stage, tail, root, back.mul(18), copy.PlanKeel, root.sub(tail).length())
			mid := at(side*wingAt(120), 120)
			arc(stage, mid, at(0, 120), at(side*95, 120), 20, copy.PlanDegrees)
		}
	}

	// The plane: its span and the wings' dihedral.
	l, r := at(-hw, 0), at(hw, 0)
	dim(5, l, r, vec{0, 0, 34}, copy.PlanSpan, math.Abs(r.x-l.x))
	root := at(Keel, 0)
	tip := at(hw, 0)
	level := vec{tip.x, tip.y, root.z}
	dihedral := Mark{Kind: Arc, Stage: 5, V: root, DirA: level.sub(root).unit(), DirB: tip.sub(root).unit(), R: 62, Label: copy.PlanDihedral}
	dihedral.Value = angleBetween(dihedral.DirA, dihedral.DirB)
	out = append(out, dihedral)
	return out
}

// wingAt is the wing crease's distance from the centre line at y, on the
// right wing (the left mirrors it).
func wingAt(y float64) float64 {
	f := folds[wingR]
	t := (y - f.a.y) / (f.b.y - f.a.y)
	return f.a.x + (f.b.x-f.a.x)*t
}

// Visible is how much of a stage's marks show at s: they draw on as its
// fold settles and leave as the next fold starts.
func Visible(stage int, s float64) float64 {
	in := smooth(clamp01((s - (float64(stage) - 0.22)) / 0.22))
	out := smooth(clamp01((s - (float64(stage) + 0.04)) / 0.26))
	return in * (1 - out)
}
