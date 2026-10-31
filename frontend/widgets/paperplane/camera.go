package paperplane

import "math"

// Camera is the anatomy kit's isometric camera: an azimuth around the
// table and an elevation above it, both in degrees. Like the kit's, it is
// orthographic: moving it changes the viewpoint, not the perspective.
type Camera struct {
	Azimuth, Elevation float64
}

// unit is the kit's projection unit, sqrt(1.6) screen units per world
// unit at scale 1.
var unit = math.Sqrt(1.6)

// cameras is where the camera stands for each stage: high over the flat
// sheet, then around the table as the paper takes shape, ending behind the
// plane and above it, where its span reads across the sheet.
var cameras = [Stages + 1]Camera{
	{Azimuth: 45, Elevation: 58},
	{Azimuth: 18, Elevation: 50},
	{Azimuth: 74, Elevation: 44},
	{Azimuth: 122, Elevation: 30},
	{Azimuth: 168, Elevation: 32},
	{Azimuth: 236, Elevation: 30},
}

// CameraAt eases between the stages' cameras: the camera starts moving a
// little before the fold and lands a little after it, along the shorter
// way round the table.
func CameraAt(s float64) Camera {
	if s <= 0 {
		return cameras[0]
	}
	if s >= Stages {
		return cameras[Stages]
	}
	i := int(math.Floor(s))
	t := smooth(clamp01((s - float64(i)) * 1.15))
	a, b := cameras[i], cameras[i+1]
	turn := math.Mod(b.Azimuth-a.Azimuth+540, 360) - 180
	return Camera{Azimuth: a.Azimuth + turn*t, Elevation: a.Elevation + (b.Elevation-a.Elevation)*t}
}

// Projection places world points on the screen: the kit's iso with an
// origin and a scale.
type Projection struct {
	Camera
	Scale  float64
	OX, OY float64
}

// view turns a world point into camera coordinates: x right and y down on
// the screen in world units, and d, its depth toward the viewer.
func (c Camera) view(p vec) (x, y, d float64) {
	a, e := c.Azimuth*math.Pi/180, c.Elevation*math.Pi/180
	sa, ca, se, ce := math.Sin(a), math.Cos(a), math.Sin(e), math.Cos(e)
	u := p.x*ca + p.y*sa
	return p.x*sa - p.y*ca, u*se - p.z*ce, u*ce + p.z*se
}

// toward is the unit vector from the table toward the viewer.
func (c Camera) toward() vec {
	a, e := c.Azimuth*math.Pi/180, c.Elevation*math.Pi/180
	return vec{math.Cos(a) * math.Cos(e), math.Sin(a) * math.Cos(e), math.Sin(e)}
}

// light comes from the camera's upper left, as the kit's does, so tones
// keep their meaning wherever the camera stands.
func (c Camera) light() vec {
	a := c.Azimuth * math.Pi / 180
	return vec{-math.Sin(a)*0.55 + math.Cos(a)*0.25, math.Cos(a)*0.55 + math.Sin(a)*0.25, 0.8}.unit()
}

// Screen projects a world point.
func (p Projection) Screen(v vec) (x, y float64) {
	vx, vy, _ := p.view(v)
	k := p.Scale * unit
	return p.OX + vx*k, p.OY + vy*k
}

// Depth is a world point's depth toward the viewer.
func (p Projection) Depth(v vec) float64 {
	_, _, d := p.view(v)
	return d
}

// Fit frames world points in a w × h box with pad on every side, as the
// kit's fitProjection does.
func Fit(c Camera, pts []vec, x0, y0, w, h, pad float64) Projection {
	left, right, up, down := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
	for _, p := range pts {
		x, y, _ := c.view(p)
		left, right = math.Min(left, x*unit), math.Max(right, x*unit)
		up, down = math.Min(up, y*unit), math.Max(down, y*unit)
	}
	scale := math.Min((w-2*pad)/math.Max(right-left, 1e-6), (h-2*pad)/math.Max(down-up, 1e-6))
	return Projection{Camera: c, Scale: scale,
		OX: x0 + w/2 - (left+right)/2*scale, OY: y0 + h/2 - (up+down)/2*scale}
}
