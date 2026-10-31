// Package paperplane draws onboarding's illustration: a sheet of A4
// folding into a dart paper plane, one fold for each step of the flow,
// seen by a camera that moves to a new viewpoint at every step, on a
// blueprint sheet with dimension lines and angle marks.
//
// The drawing follows the anatomy skill's method in native Go: one pure
// model (this file) moves the paper and gives every number the figure
// shows; an isometric camera ported from the skill's kit projects it;
// faces are filled in paper tones by facing and painted in true depth
// order. The marks follow Apple-style dimensional drawings: extension
// lines, arrowed dimension lines, dash-dot centre and crease lines, and
// angle arcs, in one ink.
package paperplane

import "math"

// The sheet is A4, in millimetres: x across (−W/2 … W/2), y along it
// (the nose at y = L), z up from the table.
const (
	SheetW = 210.0
	SheetL = 297.0
	// Keel is the depth of the plane's body at the tail: where the wing
	// creases run, measured from the centre crease.
	Keel = 30.0
)

// Stages is the number of folds: the flow's steps after the first.
const Stages = 5

// Fold angles, in degrees. A flap folded flat stops a degree or two short
// of 180 so the layers keep their order in depth.
const (
	cornerFold = 179.0
	edgeFold   = 178.0
	halfFold   = 82.0
	wingFold   = 76.0
)

type vec struct{ x, y, z float64 }

func (a vec) add(b vec) vec             { return vec{a.x + b.x, a.y + b.y, a.z + b.z} }
func (a vec) sub(b vec) vec             { return vec{a.x - b.x, a.y - b.y, a.z - b.z} }
func (a vec) mul(k float64) vec         { return vec{a.x * k, a.y * k, a.z * k} }
func (a vec) dot(b vec) float64         { return a.x*b.x + a.y*b.y + a.z*b.z }
func (a vec) length() float64           { return math.Sqrt(a.dot(a)) }
func (a vec) lerp(b vec, t float64) vec { return a.add(b.sub(a).mul(t)) }
func (a vec) cross(b vec) vec {
	return vec{a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x}
}
func (a vec) unit() vec {
	if l := a.length(); l > 0 {
		return a.mul(1 / l)
	}
	return a
}

// rotate turns p by angle radians about the line through o along the
// unit vector d (Rodrigues).
func rotate(p, o, d vec, angle float64) vec {
	v := p.sub(o)
	c, s := math.Cos(angle), math.Sin(angle)
	r := v.mul(c).add(d.cross(v).mul(s)).add(d.mul(d.dot(v) * (1 - c)))
	return o.add(r)
}

type pt struct{ x, y float64 }

func (a pt) sub(b pt) pt             { return pt{a.x - b.x, a.y - b.y} }
func (a pt) cross(b pt) float64      { return a.x*b.y - a.y*b.x }
func (a pt) lerp(b pt, t float64) pt { return pt{a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t} }

// foldID names a hinge. Their order is the order of composition: a
// point's position applies the folds it belongs to in this order, each
// hinge given in the frame the folds before it leave.
type foldID int

const (
	cornerL foldID = iota
	cornerR
	edgeL
	edgeR
	wingL
	wingR
	halfL
	halfR
	foldCount
)

type fold struct {
	a, b  pt // the hinge, in the frame its splitting frame leaves
	ref   pt // a point of the side that moves
	deg   float64
	up    bool     // the moving side starts upward (+z); else downward
	frame []foldID // folds applied, complete, before this hinge splits
	// When it runs: during stage, from lead to lead+span of the stage.
	stage      int
	lead, span float64
}

// edgeY is where the second fold's crease meets the sheet's side: the
// bisector of the 45° edge the first fold leaves.
var edgeY = SheetL - (SheetW/2)/math.Tan(22.5*math.Pi/180)

var folds = [foldCount]fold{
	cornerL: {a: pt{0, SheetL}, b: pt{-SheetW / 2, SheetL - SheetW/2}, ref: pt{-SheetW / 2, SheetL}, deg: cornerFold, up: true,
		stage: 1, lead: 0, span: 0.7},
	cornerR: {a: pt{0, SheetL}, b: pt{SheetW / 2, SheetL - SheetW/2}, ref: pt{SheetW / 2, SheetL}, deg: cornerFold, up: true,
		stage: 1, lead: 0.3, span: 0.7},
	edgeL: {a: pt{0, SheetL}, b: pt{-SheetW / 2, edgeY}, ref: pt{-SheetW / 2, 150}, deg: edgeFold, up: true,
		frame: []foldID{cornerL, cornerR}, stage: 2, lead: 0, span: 0.7},
	edgeR: {a: pt{0, SheetL}, b: pt{SheetW / 2, edgeY}, ref: pt{SheetW / 2, 150}, deg: edgeFold, up: true,
		frame: []foldID{cornerL, cornerR}, stage: 2, lead: 0.3, span: 0.7},
	wingL: {a: pt{-2, SheetL}, b: pt{-Keel, 0}, ref: pt{-SheetW / 2, 0}, deg: wingFold, up: false,
		frame: []foldID{cornerL, cornerR, edgeL, edgeR}, stage: 4, lead: 0, span: 1},
	wingR: {a: pt{2, SheetL}, b: pt{Keel, 0}, ref: pt{SheetW / 2, 0}, deg: wingFold, up: false,
		frame: []foldID{cornerL, cornerR, edgeL, edgeR}, stage: 5, lead: 0, span: 1},
	halfL: {a: pt{0, 0}, b: pt{0, SheetL}, ref: pt{-50, 100}, deg: halfFold, up: true,
		frame: []foldID{cornerL, cornerR, edgeL, edgeR}, stage: 3, lead: 0, span: 0.75},
	halfR: {a: pt{0, 0}, b: pt{0, SheetL}, ref: pt{50, 100}, deg: halfFold, up: true,
		frame: []foldID{cornerL, cornerR, edgeL, edgeR}, stage: 3, lead: 0.25, span: 0.75},
}

// signs holds each hinge's signed full angle in radians.
var signs = func() (out [foldCount]float64) {
	for id, f := range folds {
		o, d := f.axis()
		ref := vec{f.ref.x, f.ref.y, 0}
		z := rotate(ref, o, d, 0.01).z
		angle := f.deg * math.Pi / 180
		if (z > 0) != f.up {
			angle = -angle
		}
		out[id] = angle
	}
	return
}()

func (f fold) axis() (o, d vec) {
	o = vec{f.a.x, f.a.y, 0}
	return o, vec{f.b.x - f.a.x, f.b.y - f.a.y, 0}.unit()
}

// progress is how far a fold has gone at s, the flow's position: 0 is the
// flat sheet, Stages the finished plane.
func (f fold) progress(s float64) float64 {
	p := (s - float64(f.stage-1) - f.lead) / f.span
	return smooth(clamp01(p))
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// smooth eases a fold in and out, as a hand does.
func smooth(t float64) float64 { return t * t * (3 - 2*t) }

// facet is one flat piece of the sheet between creases: its corners on
// the unfolded sheet and the hinges that carry it.
type facet struct {
	flat    []pt
	members [foldCount]bool
	// crease[i] is the fold whose hinge the edge flat[i]→flat[i+1] lies
	// on, or −1.
	crease []foldID
}

// apply moves a sheet point through the facet's folds, each at the angle
// angle gives it.
func (f *facet) apply(p pt, angle func(foldID) float64) vec {
	v := vec{p.x, p.y, 0}
	for id := foldID(0); id < foldCount; id++ {
		if !f.members[id] {
			continue
		}
		if a := angle(id); a != 0 {
			o, d := folds[id].axis()
			v = rotate(v, o, d, a)
		}
	}
	return v
}

// facets is the sheet cut along every crease, computed once.
var facets = func() []facet {
	sheet := []facet{{flat: []pt{{-SheetW / 2, 0}, {SheetW / 2, 0}, {SheetW / 2, SheetL}, {-SheetW / 2, SheetL}}}}
	for id := foldID(0); id < foldCount; id++ {
		sheet = split(sheet, id)
	}
	for i := range sheet {
		sheet[i].crease = creasesOf(&sheet[i])
	}
	return sheet
}()

// creasesOf finds the hinge each edge of a facet lies on, in that
// hinge's frame.
func creasesOf(fc *facet) []foldID {
	out := make([]foldID, len(fc.flat))
	for i, p := range fc.flat {
		q := fc.flat[(i+1)%len(fc.flat)]
		out[i] = -1
		for id := foldID(0); id < foldCount; id++ {
			f := folds[id]
			inFrame := map[foldID]bool{}
			for _, g := range f.frame {
				inFrame[g] = true
			}
			full := func(g foldID) float64 {
				if inFrame[g] {
					return signs[g]
				}
				return 0
			}
			dir := f.b.sub(f.a)
			l := math.Hypot(dir.x, dir.y)
			off := func(v vec) float64 { return math.Abs(dir.cross(pt{v.x, v.y}.sub(f.a))) / l }
			if off(fc.apply(p, full)) < 1e-6 && off(fc.apply(q, full)) < 1e-6 {
				out[i] = id
				break
			}
		}
	}
	return out
}

// split cuts every facet along a hinge, in the hinge's frame, and marks
// the pieces on its moving side.
func split(in []facet, id foldID) []facet {
	f := folds[id]
	inFrame := map[foldID]bool{}
	for _, g := range f.frame {
		inFrame[g] = true
	}
	full := func(g foldID) float64 {
		if inFrame[g] {
			return signs[g]
		}
		return 0
	}
	dir := f.b.sub(f.a)
	side := func(p pt) float64 { return dir.cross(p.sub(f.a)) }
	moving := side(f.ref) > 0
	var out []facet
	for _, fc := range in {
		framed := make([]pt, len(fc.flat))
		dist := make([]float64, len(fc.flat))
		pos, neg := false, false
		for i, p := range fc.flat {
			v := fc.apply(p, full)
			framed[i] = pt{v.x, v.y}
			dist[i] = side(framed[i])
			pos = pos || dist[i] > 1e-6
			neg = neg || dist[i] < -1e-6
		}
		if !(pos && neg) {
			piece := fc
			if pos == moving && (pos || neg) {
				piece.members[id] = true
			}
			out = append(out, piece)
			continue
		}
		var a, b []pt
		n := len(fc.flat)
		for i := 0; i < n; i++ {
			j := (i + 1) % n
			p, q := fc.flat[i], fc.flat[j]
			dp, dq := dist[i], dist[j]
			if dp >= -1e-6 {
				a = append(a, p)
			}
			if dp <= 1e-6 {
				b = append(b, p)
			}
			if (dp > 1e-6 && dq < -1e-6) || (dp < -1e-6 && dq > 1e-6) {
				x := p.lerp(q, dp/(dp-dq))
				a, b = append(a, x), append(b, x)
			}
		}
		pa, pb := fc, fc
		pa.flat, pb.flat = a, b
		if moving {
			pa.members[id] = true
		} else {
			pb.members[id] = true
		}
		out = append(out, pa, pb)
	}
	return out
}

// Face is one facet placed in the world: its corners, which edges are
// the sheet's own (the rest are creases), and its index for stable order.
type Face struct {
	Pts   []vec
	Paper []bool // Paper[i]: the edge Pts[i]→Pts[i+1] is the sheet's edge
	// Creased[i]: the edge is a crease whose fold has begun.
	Creased []bool
	Index   int
}

// Pose is the paper at s, resting on the table (its lowest point at
// z = 0).
type Pose struct {
	S     float64
	Faces []Face
	angle [foldCount]float64
	dz    float64 // the table offset applied to the faces
}

// PoseAt folds the sheet to s, 0 … Stages.
func PoseAt(s float64) Pose {
	ps := Pose{S: s}
	for id := foldID(0); id < foldCount; id++ {
		ps.angle[id] = signs[id] * folds[id].progress(s)
	}
	at := func(id foldID) float64 { return ps.angle[id] }
	low := math.Inf(1)
	for i := range facets {
		fc := &facets[i]
		n := len(fc.flat)
		face := Face{Index: i, Pts: make([]vec, n), Paper: make([]bool, n), Creased: make([]bool, n)}
		for j, p := range fc.flat {
			face.Pts[j] = fc.apply(p, at)
			low = math.Min(low, face.Pts[j].z)
			face.Paper[j] = onBorder(p, fc.flat[(j+1)%n])
			if id := fc.crease[j]; id >= 0 {
				face.Creased[j] = folds[id].progress(s) > 0.005
			}
		}
		ps.Faces = append(ps.Faces, face)
	}
	for i := range ps.Faces {
		for j := range ps.Faces[i].Pts {
			ps.Faces[i].Pts[j].z -= low
		}
	}
	ps.dz = -low
	return ps
}

func onBorder(p, q pt) bool {
	const e = 1e-6
	same := func(a, b, v float64) bool { return math.Abs(a-v) < e && math.Abs(b-v) < e }
	return same(p.x, q.x, -SheetW/2) || same(p.x, q.x, SheetW/2) || same(p.y, q.y, 0) || same(p.y, q.y, SheetL)
}

// At places a point of the sheet, given on the unfolded sheet, where the
// pose has carried it.
func (ps Pose) At(x, y float64) vec {
	p := pt{x, y}
	at := func(id foldID) float64 { return ps.angle[id] }
	best, gap := -1, math.Inf(1)
	for i := range facets {
		if d := outside(facets[i].flat, p); d < gap {
			best, gap = i, d
		}
	}
	v := facets[best].apply(p, at)
	v.z += ps.dz
	return v
}

// outside is how far p lies outside a convex polygon: 0 inside.
func outside(poly []pt, p pt) float64 {
	worst := 0.0
	n := len(poly)
	area := 0.0
	for i := 0; i < n; i++ {
		area += poly[i].cross(poly[(i+1)%n])
	}
	for i := 0; i < n; i++ {
		a, b := poly[i], poly[(i+1)%n]
		e := b.sub(a)
		l := math.Hypot(e.x, e.y)
		if l == 0 {
			continue
		}
		d := e.cross(p.sub(a)) / l
		if area < 0 {
			d = -d
		}
		worst = math.Max(worst, -d)
	}
	return worst
}

// Active is the stage whose fold is moving at s, or the last one done.
func Active(s float64) int {
	st := int(math.Ceil(s - 1e-9))
	return max(0, min(Stages, st))
}

// FoldAngle is the angle the active stage's leading hinge has turned at
// s, in degrees: the figure's live readout.
func (ps Pose) FoldAngle() float64 {
	switch Active(ps.S) {
	case 1:
		return math.Abs(ps.angle[cornerL]) * 180 / math.Pi
	case 2:
		return math.Abs(ps.angle[edgeL]) * 180 / math.Pi
	case 3:
		return math.Abs(ps.angle[halfL]) * 180 / math.Pi
	case 4:
		return math.Abs(ps.angle[wingL]) * 180 / math.Pi
	case 5:
		return math.Abs(ps.angle[wingR]) * 180 / math.Pi
	}
	return 0
}

// angleBetween is the angle between two directions, in degrees.
func angleBetween(a, b vec) float64 {
	c := a.unit().dot(b.unit())
	return math.Acos(math.Max(-1, math.Min(1, c))) * 180 / math.Pi
}
