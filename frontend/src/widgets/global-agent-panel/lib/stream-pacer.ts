/**
 * The display clock for streamed reply text.
 *
 * Deltas reach the renderer on the arrival clock: the provider, the agent
 * runtime, IPC and the store each add their own batching, so a single store
 * update can carry a hundred milliseconds of output. Committing that batch
 * on the next frame aligns it to the paint but still shows it as one jump.
 * The pacer sits between the store and the Markdown renderer and meters the
 * text out per frame, with the backlog as the control signal:
 *
 *   pending = received − rendered
 *   rate    = clamp(pending / TIME_CONSTANT, MIN_RATE, MAX_RATE)
 *   budget += rate × elapsed
 *   emit    = floor(budget)
 *
 * A large backlog catches up quickly, a small one plays out gently, and the
 * 250 ms time constant makes adjacent arrival batches overlap on the display
 * clock so a staircase of arrivals reads as one curve. The budget uses real
 * elapsed time, so 60 Hz, 120 Hz and throttled pages make the same progress
 * per wall-clock second; a fraction of a grapheme carries to the next frame.
 *
 * Smoothing yields to semantics. `flush()` commits everything the moment the
 * caller knows the segment is over, and a backlog past `MAX_BACKLOG` is
 * committed whole: when the display is that far behind, freshness beats feel.
 *
 * Text is cut into grapheme clusters once, when it is enqueued, so a frame
 * never splits a surrogate pair, a combining mark or a ZWJ emoji sequence.
 */

const MIN_RATE = 20; // graphemes per second
const MAX_RATE = 800;
const TIME_CONSTANT_MS = 250;
const MAX_BACKLOG = 4096;
/** Longest interval credited to one frame, so a stalled tab does not burst. */
const MAX_ELAPSED_MS = 250;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Grapheme clusters of `text`, falling back to code points. */
export function segmentGraphemes(text: string): string[] {
  if (!text) return [];
  if (segmenter) {
    const out: string[] = [];
    for (const { segment } of segmenter.segment(text)) out.push(segment);
    return out;
  }
  return Array.from(text);
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) {
    index += 1;
  }
  return index;
}

export class StreamPacer {
  private committed = "";
  /** Everything pushed so far: `committed` followed by the pending text. */
  private received = "";
  private pending: string[] = [];
  private budget = 0;
  private lastTick: number | null = null;

  /** Text currently on screen. */
  get text(): string {
    return this.committed;
  }

  /** Graphemes received but not yet rendered. */
  get backlog(): number {
    return this.pending.length;
  }

  /**
   * Records the full text received so far. Only the suffix beyond what is
   * already queued is segmented, so each grapheme is cut once. A value that
   * retracts earlier text (the renderer trims a half-typed link while it
   * streams) drops the displayed tail to the common prefix and streams the
   * replacement from there.
   */
  push(received: string): void {
    if (received === this.received) return;
    if (received.startsWith(this.received)) {
      const wasIdle = this.pending.length === 0;
      this.pending.push(
        ...segmentGraphemes(received.slice(this.received.length)),
      );
      this.received = received;
      // The first grapheme of a reply is credited up front so it lands on
      // the next paint instead of after the minimum-rate interval.
      if (wasIdle && this.committed.length === 0) this.budget = 1;
      return;
    }
    const keep = commonPrefixLength(this.committed, received);
    this.committed = this.committed.slice(0, keep);
    this.pending = segmentGraphemes(received.slice(keep));
    this.received = received;
  }

  /**
   * Advances the display clock to `now` (milliseconds) and returns the text
   * to show, or null when nothing new is due this frame.
   */
  tick(now: number): string | null {
    const elapsed =
      this.lastTick === null
        ? 0
        : Math.min(Math.max(now - this.lastTick, 0), MAX_ELAPSED_MS);
    this.lastTick = now;
    const pending = this.pending.length;
    if (pending === 0) {
      this.budget = 0;
      return null;
    }
    if (pending > MAX_BACKLOG) return this.flush();
    const rate = Math.min(
      Math.max((pending * 1000) / TIME_CONSTANT_MS, MIN_RATE),
      MAX_RATE,
    );
    this.budget += (rate * elapsed) / 1000;
    const emit = Math.min(Math.floor(this.budget), pending);
    if (emit === 0) return null;
    this.budget -= emit;
    return this.commit(emit);
  }

  /** Commits the whole backlog. Returns the text to show, or null if none. */
  flush(): string | null {
    if (this.pending.length === 0) return null;
    this.budget = 0;
    return this.commit(this.pending.length);
  }

  private commit(count: number): string {
    this.committed += this.pending.splice(0, count).join("");
    return this.committed;
  }
}
