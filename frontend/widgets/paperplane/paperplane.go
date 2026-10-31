package paperplane

import (
	"math"
	"strings"
	"time"

	"github.com/AstraFoundry/telo/frontend/shared/copy"
	"github.com/AstraFoundry/telo/frontend/shared/theme"
	"github.com/egoist/mygo/ui"
)

// Figure keeps the folding between frames: the stage it heads for and
// the tween that carries the paper there.
type Figure struct {
	from, to float64
	start    time.Time
	dur      time.Duration
	epoch    time.Time
	started  bool
}

// perStage is how long one fold takes; a jump of several stages takes a
// little longer, never the sum.
const perStage = 1500 * time.Millisecond

// value is the flow position at now.
func (f *Figure) value(now time.Time) float64 {
	if f.dur <= 0 || !now.Before(f.start.Add(f.dur)) {
		return f.to
	}
	t := float64(now.Sub(f.start)) / float64(f.dur)
	e := 0.5 - 0.5*math.Cos(math.Pi*t)
	return f.from + (f.to-f.from)*e
}

// Target is the stage the figure folds toward.
func (f *Figure) Target() int { return int(f.to) }

// head points the figure at stage, from wherever the paper is.
func (f *Figure) head(now time.Time, stage int, still bool) {
	to := float64(max(0, min(Stages, stage)))
	if !f.started {
		f.started, f.from, f.to, f.epoch = true, to, to, now
		return
	}
	if to == f.to {
		return
	}
	cur := f.value(now)
	f.from, f.to, f.start = cur, to, now
	f.dur = 0
	if !still {
		steps := math.Abs(to - cur)
		f.dur = time.Duration(float64(perStage) * math.Min(1.7, math.Max(0.6, math.Sqrt(steps))))
	}
}

// Render fills its box with the blueprint and the paper at stage, 0 (the
// flat sheet) to Stages (the plane). top is the room the window's title
// bar takes at the box's top.
func (f *Figure) Render(c *ui.Context, t theme.Tokens, stage int, top float32) {
	f.head(c.Now(), stage, t.Still)
	ui.Box(c).Fill().Background(t.PlanGround).Role(ui.RoleImage).Label(copy.T(copy.PlanLabel)).
		Draw(func(p *ui.Painter, r ui.Rect) { f.paint(p, r, t, top) })
}

// sheet is one frame's drawing state.
type sheet struct {
	p      *ui.Painter
	t      theme.Tokens
	pr     Projection
	faces  []*Face
	fills  map[*Face]ui.Color
	shapes map[*Face][][2]float64
}

func (f *Figure) paint(p *ui.Painter, r ui.Rect, t theme.Tokens, top float32) {
	now := p.Now()
	s := f.value(now)
	if s != f.to {
		p.AnimationFrame()
	} else if !t.Still {
		p.AnimationFrameRate(30)
	}
	idle := 0.0
	if !t.Still {
		idle = now.Sub(f.epoch).Seconds()
	}
	grid(p, r, t)
	frame := ui.Rect{X: r.X + 12, Y: r.Y + top, W: r.W - 24, H: r.H - top - 12}
	p.Stroke(frame, t.PlanInkMuted, 0, 0.8)
	p.Stroke(ui.Rect{X: frame.X + 3, Y: frame.Y + 3, W: frame.W - 6, H: frame.H - 6}, t.PlanGridMajor, 0, 0.5)
	const block = 46
	area := ui.Rect{X: frame.X + 14, Y: frame.Y + 26, W: frame.W - 28, H: frame.H - 26 - block - 14}

	ps := PoseAt(s)
	cam := CameraAt(s)
	cam.Azimuth += 2.4 * math.Sin(idle*2*math.Pi/17)
	// The finished plane lifts off the table and floats.
	flight := smooth(clamp01((s - (Stages - 0.35)) / 0.35))
	lift := vec{0, 0, flight * (24 + 3*math.Sin(idle*2*math.Pi/3.8))}
	var fit []vec
	for _, fc := range ps.Faces {
		for _, v := range fc.Pts {
			fit = append(fit, v, v.add(vec{0, 0, flight * 24}), vec{v.x - 26, v.y - 26, v.z}, vec{v.x + 26, v.y + 26, v.z},
				vec{v.x - 26, v.y + 26, v.z}, vec{v.x + 26, v.y - 26, v.z})
		}
	}
	pr := Fit(cam, fit, float64(area.X), float64(area.Y), float64(area.W), float64(area.H), 6)

	sh := &sheet{p: p, t: t, pr: pr, fills: map[*Face]ui.Color{}, shapes: map[*Face][][2]float64{}}
	sh.shadow(ps, lift, flight)
	for i := range ps.Faces {
		for j := range ps.Faces[i].Pts {
			ps.Faces[i].Pts[j] = ps.Faces[i].Pts[j].add(lift)
		}
	}
	sh.faces = order(cam, ps.Faces)
	for _, fc := range sh.faces {
		sh.face(fc)
	}
	for _, m := range ps.Marks() {
		if a := Visible(m.Stage, s); a > 0.01 {
			sh.mark(m, lift, float32(a))
		}
	}
	sh.lettering(frame, block, ps, s)
}

// grid rules the blueprint: a fine square every 12, a stronger one every
// 60.
func grid(p *ui.Painter, r ui.Rect, t theme.Tokens) {
	for x := float32(0); x <= r.W; x += 12 {
		c, w := t.PlanGrid, float32(1)
		if int(x)%60 == 0 {
			c = t.PlanGridMajor
		}
		p.Line(r.X+x, r.Y, r.X+x, r.Y+r.H, w, c)
	}
	for y := float32(0); y <= r.H; y += 12 {
		c, w := t.PlanGrid, float32(1)
		if int(y)%60 == 0 {
			c = t.PlanGridMajor
		}
		p.Line(r.X, r.Y+y, r.X+r.W, r.Y+y, w, c)
	}
}

func (sh *sheet) screen(v vec) [2]float64 {
	x, y := sh.pr.Screen(v)
	return [2]float64{x, y}
}

func (sh *sheet) path(pts [][2]float64, closed bool) *ui.Path {
	path := &ui.Path{}
	for i, q := range pts {
		if i == 0 {
			path.MoveTo(float32(q[0]), float32(q[1]))
		} else {
			path.LineTo(float32(q[0]), float32(q[1]))
		}
	}
	if closed {
		path.Close()
	}
	return path
}

// shadow is the soft footprint the paper casts on the table, fainter and
// wider the higher the plane floats.
func (sh *sheet) shadow(ps Pose, lift vec, flight float64) {
	var foot [][2]float64
	for _, fc := range ps.Faces {
		for _, v := range fc.Pts {
			foot = append(foot, sh.screen(vec{v.x + 4 + lift.z*0.3, v.y - 4 - lift.z*0.3, 0}))
		}
	}
	h := hull(foot)
	if len(h) < 3 {
		return
	}
	cx, cy := centroid(h)
	for i, grow := range []float64{1.04, 1} {
		ring := make([][2]float64, len(h))
		for k, q := range h {
			ring[k] = [2]float64{cx + (q[0]-cx)*grow, cy + (q[1]-cy)*grow}
		}
		alpha := float32((0.45 + 0.35*float64(i)) * (1 - 0.5*flight))
		sh.p.FillPath(sh.path(ring, true), sh.t.PaperShadow.Alpha(alpha))
	}
}

// face fills a facet in its tone by facing, as the kit's extrude does,
// and inks its edges: the sheet's cut edges firm, its creases faint.
func (sh *sheet) face(fc *Face) {
	pts := make([][2]float64, len(fc.Pts))
	for i, v := range fc.Pts {
		pts[i] = sh.screen(v)
	}
	sh.shapes[fc] = pts
	if area(pts) < 0.05 {
		sh.edges(fc, pts)
		return
	}
	n := fc.Pts[1].sub(fc.Pts[0]).cross(fc.Pts[2].sub(fc.Pts[0])).unit()
	if n.length() == 0 && len(fc.Pts) > 3 {
		n = fc.Pts[2].sub(fc.Pts[0]).cross(fc.Pts[3].sub(fc.Pts[0])).unit()
	}
	if n.dot(sh.pr.toward()) < 0 {
		n = n.mul(-1)
	}
	lit := (n.dot(sh.pr.light()) + 1) / 2
	tone := sh.t.PaperTop
	if shade := int(math.Floor(lit * 5)); shade < 4 {
		tone = sh.t.PaperShade[max(0, shade)]
	}
	sh.fills[fc] = tone
	sh.p.FillPath(sh.path(pts, true), tone)
	sh.edges(fc, pts)
}

// edges inks a face's edges: the sheet's cut edges firm, creases faint
// once their fold has begun, and seams between pieces of paper not yet
// creased in the face's own tone, so the sheet reads as one piece.
func (sh *sheet) edges(fc *Face, pts [][2]float64) {
	for i := range pts {
		j := (i + 1) % len(pts)
		var c ui.Color
		w := float32(0.6)
		switch {
		case fc.Paper[i]:
			c, w = sh.t.PaperEdge, 1.05
		case fc.Creased[i]:
			c = sh.t.PaperCrease
		default:
			tone, ok := sh.fills[fc]
			if !ok {
				continue
			}
			c, w = tone, 0.8
		}
		sh.p.StrokePath(sh.path([][2]float64{pts[i], pts[j]}, false), w, c)
	}
}

// onPaper is the fill of the paper over a screen point, nearest first.
func (sh *sheet) onPaper(q [2]float64) (ui.Color, bool) {
	for i := len(sh.faces) - 1; i >= 0; i-- {
		fc := sh.faces[i]
		if inside(sh.shapes[fc], q) {
			c, ok := sh.fills[fc]
			return c, ok
		}
	}
	return ui.Color{}, false
}

func inside(poly [][2]float64, q [2]float64) bool {
	if len(poly) < 3 {
		return false
	}
	sign := 0.0
	for i := range poly {
		a, b := poly[i], poly[(i+1)%len(poly)]
		c := (b[0]-a[0])*(q[1]-a[1]) - (b[1]-a[1])*(q[0]-a[0])
		if c != 0 {
			if sign != 0 && (c > 0) != (sign > 0) {
				return false
			}
			sign = c
		}
	}
	return true
}

// ink is the mark colour over a point: the blueprint's ink on the ground,
// the paper's edge ink over the paper.
func (sh *sheet) ink(q [2]float64, active bool) (ui.Color, ui.Color) {
	if under, ok := sh.onPaper(q); ok {
		if active {
			return sh.t.PaperActive, under
		}
		return sh.t.PaperEdge, under
	}
	if active {
		return sh.t.PlanActive, sh.t.PlanGround
	}
	return sh.t.PlanInk, sh.t.PlanGround
}

func (sh *sheet) mark(m Mark, lift vec, alpha float32) {
	m.A, m.B, m.V = m.A.add(lift), m.B.add(lift), m.V.add(lift)
	switch m.Kind {
	case Centre, Crease:
		a, b := sh.screen(m.A), sh.screen(m.B)
		ink, _ := sh.ink([2]float64{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2}, m.Kind == Crease)
		path := sh.path([][2]float64{a, b}, false).Dash(0, 9, 2.5, 1.2, 2.5).Trim(0, alpha)
		sh.p.StrokePath(path, 0.8, ink.Alpha(alpha))
		if m.Kind == Centre {
			end := a
			if m.Far {
				end = b
			}
			sh.label(copy.T(m.Label), end, alpha, false)
		}
	case Dim:
		sh.dim(m, alpha)
	case Arc:
		sh.arc(m, alpha)
	}
}

// dim draws a dimension as the drawings do: extension lines that start a
// little off the feature and overshoot the dimension line, filled arrows
// at both ends, and the label on the line over a knockout.
func (sh *sheet) dim(m Mark, alpha float32) {
	off := m.Off
	ea, eb := m.A.add(off), m.B.add(off)
	a, b := sh.screen(ea), sh.screen(eb)
	ink, _ := sh.ink([2]float64{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2}, false)
	ink = ink.Alpha(alpha)
	for _, end := range []vec{m.A, m.B} {
		from, to := sh.screen(end.add(off.mul(0.18))), sh.screen(end.add(off.mul(1.22)))
		sh.p.StrokePath(sh.path([][2]float64{from, to}, false).Trim(0, alpha), 0.55, ink)
	}
	sh.p.StrokePath(sh.path([][2]float64{a, b}, false).Trim(0.5-alpha/2, 0.5+alpha/2), 0.7, ink)
	ux, uy := b[0]-a[0], b[1]-a[1]
	l := math.Hypot(ux, uy)
	if l < 1 {
		return
	}
	ux, uy = ux/l, uy/l
	for _, end := range []struct {
		at  [2]float64
		dir float64
	}{{a, 1}, {b, -1}} {
		tip := end.at
		bx, by := tip[0]+ux*6*end.dir, tip[1]+uy*6*end.dir
		head := [][2]float64{tip, {bx - uy*2.1, by + ux*2.1}, {bx + uy*2.1, by - ux*2.1}}
		sh.p.FillPath(sh.path(head, true), ink)
	}
	sh.label(copy.F(m.Label, m.Value), [2]float64{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2}, alpha, false)
}

// arc draws an angle: the arc between the two directions, short ticks at
// its ends, and the angle beside its middle.
func (sh *sheet) arc(m Mark, alpha float32) {
	axis := m.DirA.cross(m.DirB)
	if axis.length() < 1e-9 {
		return
	}
	axis = axis.unit()
	span := angleBetween(m.DirA, m.DirB) * math.Pi / 180
	var pts [][2]float64
	for i := 0; i <= 24; i++ {
		pts = append(pts, sh.screen(rotate(m.V.add(m.DirA.mul(m.R)), m.V, axis, span*float64(i)/24)))
	}
	mid := sh.screen(rotate(m.V.add(m.DirA.mul(m.R*1.5)), m.V, axis, span/2))
	ink, _ := sh.ink(pts[12], true)
	ink = ink.Alpha(alpha)
	sh.p.StrokePath(sh.path(pts, false).Trim(0, alpha), 0.9, ink)
	for _, d := range []vec{m.DirA, m.DirB} {
		from, to := sh.screen(m.V.add(d.mul(m.R*0.82))), sh.screen(m.V.add(d.mul(m.R*1.12)))
		sh.p.StrokePath(sh.path([][2]float64{from, to}, false), 0.7, ink)
	}
	sh.label(copy.F(m.Label, m.Value), mid, alpha, true)
}

// label letters a mark at q, centred, over a knockout of what lies
// beneath it.
func (sh *sheet) label(text string, q [2]float64, alpha float32, active bool) {
	ink, under := sh.ink(q, active)
	span := ui.Span{Text: strings.ToUpper(text), Font: "monospace", Size: 8.5, LetterSpacing: 0.4, Color: ink.Alpha(alpha)}
	w, h := sh.p.MeasureText(0, span)
	x, y := float32(q[0])-w/2, float32(q[1])-h/2
	sh.p.Fill(ui.Rect{X: x - 2.5, Y: y - 0.5, W: w + 5, H: h + 1}, under.Alpha(alpha), 1.5)
	sh.p.RichText(x, y, 0, span)
}

// lettering is the sheet's frame text: the figure number and the step's
// title above, a title block below with the part, the stock, the fold,
// the scale and the live angle.
func (sh *sheet) lettering(frame ui.Rect, block float32, ps Pose, s float64) {
	t := sh.t
	stage := Active(s)
	text := func(s string, x, y float32, c ui.Color, right bool) {
		span := ui.Span{Text: s, Font: "monospace", Size: 8.5, LetterSpacing: 0.8, Color: c}
		if right {
			w, _ := sh.p.MeasureText(0, span)
			x -= w
		}
		sh.p.RichText(x, y, 0, span)
	}
	caps := strings.ToUpper
	text(caps(copy.F(copy.PlanFigure, stage+1)), frame.X+10, frame.Y+11, t.PlanInk, false)
	text(caps(copy.T(titles[stage])), frame.X+frame.W-10, frame.Y+11, t.PlanInkMuted, true)

	b := ui.Rect{X: frame.X + 10, Y: frame.Y + frame.H - block - 10, W: frame.W - 20, H: block}
	sh.p.Stroke(b, t.PlanInkMuted, 0, 0.8)
	sh.p.Line(b.X, b.Y+b.H/2, b.X+b.W, b.Y+b.H/2, 0.6, t.PlanInkMuted)
	split := b.X + b.W*0.42
	sh.p.Line(split, b.Y, split, b.Y+b.H, 0.6, t.PlanInkMuted)
	row := func(i int) float32 { return b.Y + b.H/2*float32(i) + 7 }
	// 96 DIPs to the inch: millimetres on the sheet to millimetres drawn.
	drawn := sh.pr.Scale * unit / (96 / 25.4)
	text(caps(copy.T(copy.PlanPart)), b.X+7, row(0), t.PlanInk, false)
	text(caps(copy.F(copy.PlanStock, SheetW, SheetL)), b.X+b.W-7, row(0), t.PlanInkMuted, true)
	text(caps(copy.F(copy.PlanFold, stage, Stages)), b.X+7, row(1), t.PlanInkMuted, false)
	text(caps(copy.F(copy.PlanScale, 1/math.Max(drawn, 1e-6))), split+7, row(1), t.PlanInkMuted, false)
	text(copy.F(copy.PlanAngle, ps.FoldAngle()), b.X+b.W-7, row(1), t.PlanActive, true)
}

var titles = [Stages + 1]copy.Key{copy.PlanTitle0, copy.PlanTitle1, copy.PlanTitle2, copy.PlanTitle3, copy.PlanTitle4, copy.PlanTitle5}
