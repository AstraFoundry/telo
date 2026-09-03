/**
 * The drifting dot field Telegram covers a spoiler with.
 *
 * Architecture copied from Telegram Web K (`components/dotRenderer.ts`): one
 * simulation runs for the whole app and every spoiler blits a randomly
 * offset, randomly flipped slice of it. Per-spoiler simulations are the
 * obvious implementation and the wrong one — a screenful of them multiplies
 * the particle budget by the number of spoilers, and neighbouring covers then
 * animate in visible lockstep.
 *
 * Web K runs this as a WebGL2 curl-noise field with transform feedback. This
 * is the 2D-canvas equivalent at the same tuning: the particle density, dot
 * size, lifetime spread, and per-particle alpha curve are Web K's numbers
 * (`dotRendererCore.ts:29-49`, `spoiler_vertex.glsl:96-134`), while the force
 * field is a cheap two-octave sine field instead of curl noise, because at
 * 1.6px dots nobody can tell the difference and it costs no shader.
 */

/**
 * Web K's tiles and their particle densities. Media is the base density from
 * `dotRendererCore.ts:29-31` (`w*h/250000 * 1000 * 10` → 0.04/px²); text
 * quadruples it (`dotRenderer.ts:33-43`), because inline runs are short and a
 * sparse field over a line of text reads as speckle rather than as a cover.
 */
export const TEXT_TILE = { width: 240, height: 120, density: 0.16 } as const;
export const MEDIA_TILE = { width: 480, height: 480, density: 0.04 } as const;

const MIN_PARTICLES = 200;
const MAX_PARTICLES = 10000;
/** Dot side in CSS px. Web K uses 1.6 for media and 1.8 for text. */
const DOT_PX = 1.8;
/** `longevity` / `timeScale` (`dotRendererCore.ts:44-47`). */
const LONGEVITY = 1.4;
const TIME_SCALE = 0.65;
/** Per-particle lifetime multiplier `0.5 + 2*rand` (`spoiler_vertex.glsl:96`). */
const MIN_DURATION = 0.5;
const DURATION_SPREAD = 2;
/** Per-particle alpha peak `0.6 + 0.4*rand` (`spoiler_vertex.glsl:134`). */
const MIN_PEAK = 0.6;
const PEAK_SPREAD = 0.4;
/**
 * Alpha buckets the draw pass batches into, so `globalAlpha` is set eight
 * times a frame instead of once per particle.
 */
const ALPHA_BUCKETS = 8;
/** Drift speed as a fraction of the tile's short side, per second. */
const DRIFT = 0.05;
/**
 * Web K caps the text simulation's device pixel ratio at 2 with the note that
 * a higher one makes the seams between repeated blits visible
 * (`dotRenderer.ts:571`).
 */
const MAX_DPR = 2;

interface Particle {
  x: number;
  y: number;
  /** Phase in `0..1`; the dot fades in and out across one pass. */
  t: number;
  /** Lifetime multiplier: how fast this dot walks its phase. */
  duration: number;
  /** Peak alpha of this dot's fade. */
  peak: number;
  /** Per-particle phase offsets into the shared force field. */
  seedX: number;
  seedY: number;
}

export interface SpoilerTile {
  readonly width: number;
  readonly height: number;
  /** Dots per CSS pixel² of tile. */
  readonly density: number;
}

function particleCount(tile: SpoilerTile): number {
  return Math.round(
    Math.min(
      MAX_PARTICLES,
      Math.max(MIN_PARTICLES, tile.width * tile.height * tile.density),
    ),
  );
}

/**
 * A running field. Consumers subscribe to be called after each simulation
 * step and blit `canvas`; the loop stops as soon as the last one leaves, so
 * an off-screen chat costs nothing.
 */
export interface SpoilerField {
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  /** Registers a per-frame blit. Returns the unsubscribe. */
  subscribe(draw: () => void): () => void;
}

const fields = new Map<string, SpoilerField>();

/**
 * The field for a tile size and dot colour, created on first use and shared
 * from then on. `color` is any canvas fill style; pass the resolved theme
 * colour, since a `currentColor`-style indirection has no meaning inside a
 * canvas.
 */
export function spoilerField(tile: SpoilerTile, color: string): SpoilerField {
  const key = `${tile.width}x${tile.height}|${color}`;
  const existing = fields.get(key);
  if (existing) return existing;
  const field = createField(tile, color);
  fields.set(key, field);
  return field;
}

function createField(tile: SpoilerTile, color: string): SpoilerField {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(tile.width * dpr);
  canvas.height = Math.round(tile.height * dpr);
  const context = canvas.getContext("2d");
  const count = particleCount(tile);
  const particles: Particle[] = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    t: Math.random(),
    duration: MIN_DURATION + DURATION_SPREAD * Math.random(),
    peak: MIN_PEAK + PEAK_SPREAD * Math.random(),
    seedX: Math.random() * Math.PI * 2,
    seedY: Math.random() * Math.PI * 2,
  }));

  const drift = DRIFT * Math.min(canvas.width, canvas.height);
  const dot = Math.max(1, Math.round(DOT_PX * dpr));
  const subscribers = new Set<() => void>();
  let frame: number | null = null;
  let last = 0;

  const step = (now: number) => {
    // Frame-rate independent, and clamped so a backgrounded tab does not
    // teleport the whole field on its first frame back
    // (`dotRendererCore.ts:171`).
    const seconds = Math.min(last ? (now - last) / 1000 : 0, 1) * TIME_SCALE;
    last = now;
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = color;
      const buckets: Particle[][] = Array.from(
        { length: ALPHA_BUCKETS },
        () => [],
      );
      for (const particle of particles) {
        particle.t += (seconds * particle.duration) / LONGEVITY;
        if (particle.t >= 1) {
          // A finished dot is recycled somewhere else rather than pooled in
          // place, which is what keeps the field from developing texture.
          particle.t -= 1;
          particle.x = Math.random() * canvas.width;
          particle.y = Math.random() * canvas.height;
          particle.duration = MIN_DURATION + DURATION_SPREAD * Math.random();
          particle.peak = MIN_PEAK + PEAK_SPREAD * Math.random();
        }
        const phase = now / 1000;
        particle.x += Math.sin(phase + particle.seedX) * drift * seconds;
        particle.y += Math.cos(phase * 0.8 + particle.seedY) * drift * seconds;
        const alpha = Math.sin(particle.t * Math.PI) * particle.peak;
        const bucket = Math.min(
          ALPHA_BUCKETS - 1,
          Math.floor(alpha * ALPHA_BUCKETS),
        );
        if (bucket > 0) buckets[bucket].push(particle);
      }
      for (let bucket = 1; bucket < ALPHA_BUCKETS; bucket += 1) {
        const members = buckets[bucket];
        if (members.length === 0) continue;
        context.globalAlpha = (bucket + 0.5) / ALPHA_BUCKETS;
        for (const particle of members) {
          // Wrapped rather than clamped: a dot that drifts off one edge has
          // to reappear on the other, or the tile's borders go bald and the
          // seams between blits become visible.
          const x = ((particle.x % canvas.width) + canvas.width) % canvas.width;
          const y =
            ((particle.y % canvas.height) + canvas.height) % canvas.height;
          context.fillRect(x, y, dot, dot);
        }
      }
      context.globalAlpha = 1;
    }
    for (const draw of subscribers) draw();
    frame = requestAnimationFrame(step);
  };

  return {
    canvas,
    dpr,
    subscribe(draw) {
      subscribers.add(draw);
      if (frame === null) {
        last = 0;
        frame = requestAnimationFrame(step);
      }
      return () => {
        subscribers.delete(draw);
        if (subscribers.size === 0 && frame !== null) {
          cancelAnimationFrame(frame);
          frame = null;
        }
      };
    },
  };
}

/**
 * Paints one static frame of the field into a canvas of its own, for readers
 * who asked for reduced motion. Telegram Desktop's power-saving path is the
 * model: `PowerSaving::kChatSpoiler` freezes the animation index but still
 * fills the spoiler rect. The cover is a privacy feature, so it never
 * degrades to "revealed" — only to "not moving".
 */
export function paintStillField(
  target: CanvasRenderingContext2D,
  tile: SpoilerTile,
  color: string,
  dpr: number,
): void {
  const count = particleCount(tile);
  const dot = Math.max(1, Math.round(DOT_PX * dpr));
  target.fillStyle = color;
  for (let index = 0; index < count; index += 1) {
    target.globalAlpha =
      MIN_PEAK * (0.4 + 0.6 * Math.random()) + PEAK_SPREAD * Math.random();
    target.fillRect(
      Math.random() * target.canvas.width,
      Math.random() * target.canvas.height,
      dot,
      dot,
    );
  }
  target.globalAlpha = 1;
}
