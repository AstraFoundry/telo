package paperplane

import (
	"math"
	"sort"
)

// placed is a face in camera coordinates: x, y on the screen (world
// units) and d toward the viewer.
type placed struct {
	face   *Face
	pts    [][3]float64
	plane  [3]float64 // d = a·x + b·y + c; flat is set for edge-on faces
	flat   bool
	center float64 // mean depth, the fallback order
}

// order returns the faces back to front. Where two faces overlap on the
// screen, the one nearer at a point of the overlap is drawn later, as the
// kit's settle measures true depth at every overlap rather than sorting
// by centres; faces that overlap nothing keep their centre depth.
func order(c Camera, faces []Face) []*Face {
	ps := make([]placed, len(faces))
	for i := range faces {
		f := &faces[i]
		p := placed{face: f}
		for _, v := range f.Pts {
			x, y, d := c.view(v)
			p.pts = append(p.pts, [3]float64{x, y, d})
			p.center += d
		}
		p.center /= float64(len(f.Pts))
		p.plane, p.flat = planeOf(p.pts)
		ps[i] = p
	}
	n := len(ps)
	after := make([][]int, n) // after[i]: faces drawn after i
	ins := make([]int, n)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			ov := clip(ps[i].pts, ps[j].pts)
			if area(ov) < 1e-3 {
				continue
			}
			cx, cy := centroid(ov)
			di, dj := ps[i].depthAt(cx, cy), ps[j].depthAt(cx, cy)
			if math.Abs(di-dj) < 1e-9 {
				continue
			}
			if di < dj {
				after[i] = append(after[i], j)
				ins[j]++
			} else {
				after[j] = append(after[j], i)
				ins[i]++
			}
		}
	}
	// Kahn's sort, taking the farthest ready face first; a cycle (two
	// faces that interlock) falls back to centre depth.
	done := make([]bool, n)
	out := make([]*Face, 0, n)
	for len(out) < n {
		pick := -1
		for i := 0; i < n; i++ {
			if done[i] || ins[i] > 0 {
				continue
			}
			if pick < 0 || less(ps[i], ps[pick]) {
				pick = i
			}
		}
		if pick < 0 {
			for i := 0; i < n; i++ {
				if !done[i] && (pick < 0 || less(ps[i], ps[pick])) {
					pick = i
				}
			}
		}
		done[pick] = true
		out = append(out, ps[pick].face)
		for _, j := range after[pick] {
			ins[j]--
		}
	}
	return out
}

func less(a, b placed) bool {
	if a.center != b.center {
		return a.center < b.center
	}
	return a.face.Index < b.face.Index
}

func (p placed) depthAt(x, y float64) float64 {
	if p.flat {
		return p.center
	}
	return p.plane[0]*x + p.plane[1]*y + p.plane[2]
}

// planeOf fits d over the face's screen points; an edge-on face has none.
func planeOf(pts [][3]float64) ([3]float64, bool) {
	a, b, c := pts[0], pts[1], pts[2]
	best := 0.0
	for k := 2; k < len(pts); k++ {
		q := pts[k]
		det := (pts[1][0]-a[0])*(q[1]-a[1]) - (q[0]-a[0])*(pts[1][1]-a[1])
		if math.Abs(det) > math.Abs(best) {
			best, c = det, q
		}
	}
	if math.Abs(best) < 1e-6 {
		return [3]float64{}, true
	}
	// Solve d = A x + B y + C through a, b, c.
	ux, uy, ud := b[0]-a[0], b[1]-a[1], b[2]-a[2]
	vx, vy, vd := c[0]-a[0], c[1]-a[1], c[2]-a[2]
	det := ux*vy - vx*uy
	A := (ud*vy - vd*uy) / det
	B := (ux*vd - vx*ud) / det
	return [3]float64{A, B, a[2] - A*a[0] - B*a[1]}, false
}

// clip intersects two convex polygons (Sutherland–Hodgman).
func clip(subject, by [][3]float64) [][2]float64 {
	out := make([][2]float64, len(subject))
	for i, p := range subject {
		out[i] = [2]float64{p[0], p[1]}
	}
	if signed(by) < 0 {
		rev := make([][3]float64, len(by))
		for i := range by {
			rev[i] = by[len(by)-1-i]
		}
		by = rev
	}
	for i := range by {
		if len(out) == 0 {
			break
		}
		a, b := by[i], by[(i+1)%len(by)]
		inside := func(p [2]float64) float64 { return (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]) }
		in := out
		out = nil
		for k := range in {
			p, q := in[k], in[(k+1)%len(in)]
			dp, dq := inside(p), inside(q)
			if dp >= 0 {
				out = append(out, p)
			}
			if (dp >= 0) != (dq >= 0) {
				t := dp / (dp - dq)
				out = append(out, [2]float64{p[0] + (q[0]-p[0])*t, p[1] + (q[1]-p[1])*t})
			}
		}
	}
	return out
}

func signed(p [][3]float64) float64 {
	s := 0.0
	for i := range p {
		q := p[(i+1)%len(p)]
		s += p[i][0]*q[1] - q[0]*p[i][1]
	}
	return s / 2
}

func area(p [][2]float64) float64 {
	s := 0.0
	for i := range p {
		q := p[(i+1)%len(p)]
		s += p[i][0]*q[1] - q[0]*p[i][1]
	}
	return math.Abs(s / 2)
}

func centroid(p [][2]float64) (float64, float64) {
	var x, y float64
	for _, q := range p {
		x += q[0]
		y += q[1]
	}
	return x / float64(len(p)), y / float64(len(p))
}

// hull is the convex hull of screen points (monotone chain), for the
// shadow the paper casts on the table.
func hull(pts [][2]float64) [][2]float64 {
	if len(pts) < 3 {
		return pts
	}
	ps := append([][2]float64(nil), pts...)
	sort.Slice(ps, func(i, j int) bool {
		if ps[i][0] != ps[j][0] {
			return ps[i][0] < ps[j][0]
		}
		return ps[i][1] < ps[j][1]
	})
	cross := func(o, a, b [2]float64) float64 {
		return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
	}
	var lower, upper [][2]float64
	for _, p := range ps {
		for len(lower) >= 2 && cross(lower[len(lower)-2], lower[len(lower)-1], p) <= 0 {
			lower = lower[:len(lower)-1]
		}
		lower = append(lower, p)
	}
	for i := len(ps) - 1; i >= 0; i-- {
		p := ps[i]
		for len(upper) >= 2 && cross(upper[len(upper)-2], upper[len(upper)-1], p) <= 0 {
			upper = upper[:len(upper)-1]
		}
		upper = append(upper, p)
	}
	return append(lower[:len(lower)-1], upper[:len(upper)-1]...)
}
