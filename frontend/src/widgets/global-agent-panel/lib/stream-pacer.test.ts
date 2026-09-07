import { describe, expect, it } from "vitest";

import { StreamPacer, segmentGraphemes } from "./stream-pacer";

/** Runs frames at a fixed interval until `until` ms and returns the text. */
function play(pacer: StreamPacer, from: number, until: number, step: number) {
  let text = pacer.text;
  for (let now = from; now <= until; now += step) {
    text = pacer.tick(now) ?? text;
  }
  return text;
}

describe("segmentGraphemes", () => {
  it("keeps emoji sequences and combining marks whole", () => {
    expect(segmentGraphemes("a👨‍👩‍👧é🇯🇵")).toEqual(["a", "👨‍👩‍👧", "é", "🇯🇵"]);
  });

  it("returns nothing for an empty string", () => {
    expect(segmentGraphemes("")).toEqual([]);
  });
});

describe("StreamPacer", () => {
  it("shows the first grapheme on the first frame", () => {
    const pacer = new StreamPacer();
    pacer.push("Hello");
    expect(pacer.tick(0)).toBe("H");
  });

  it("makes the same progress per wall-clock second at 60 Hz and at 120 Hz", () => {
    const text = "x".repeat(400);
    const at60 = new StreamPacer();
    const at120 = new StreamPacer();
    at60.push(text);
    at120.push(text);
    const shown60 = play(at60, 0, 300, 1000 / 60);
    const shown120 = play(at120, 0, 300, 1000 / 120);
    expect(Math.abs(shown60.length - shown120.length)).toBeLessThanOrEqual(2);
    expect(shown60.length).toBeGreaterThan(0);
    expect(shown60.length).toBeLessThan(text.length);
  });

  it("speeds up with a larger backlog and slows down as it drains", () => {
    const small = new StreamPacer();
    small.push("x".repeat(10));
    small.tick(0);
    const large = new StreamPacer();
    large.push("x".repeat(500));
    large.tick(0);
    const smallShown = small.tick(100)?.length ?? 0;
    const largeShown = large.tick(100)?.length ?? 0;
    expect(largeShown).toBeGreaterThan(smallShown);
    // Nine pending after the seeded first grapheme: 36/s, three per 100 ms.
    expect(smallShown).toBe(4);
  });

  it("never splits a grapheme cluster across frames", () => {
    const pacer = new StreamPacer();
    pacer.push("👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧");
    const first = pacer.tick(0);
    expect(first).toBe("👨‍👩‍👧");
    const shown = play(pacer, 16, 400, 16);
    expect(shown.length % "👨‍👩‍👧".length).toBe(0);
  });

  it("carries a fractional budget to the next frame", () => {
    const pacer = new StreamPacer();
    pacer.push("abcdefghij");
    pacer.tick(0); // seeded first grapheme
    // Nine pending run at 36/s: 25 ms earns 0.9 of a grapheme, twice makes one.
    expect(pacer.tick(25)).toBeNull();
    expect(pacer.tick(50)).toBe("ab");
  });

  it("segments only the new suffix on each push", () => {
    const pacer = new StreamPacer();
    pacer.push("ab");
    pacer.push("abcd");
    expect(pacer.backlog).toBe(4);
    pacer.push("abcd");
    expect(pacer.backlog).toBe(4);
  });

  it("flushes the whole backlog on demand", () => {
    const pacer = new StreamPacer();
    pacer.push("finished reply");
    expect(pacer.flush()).toBe("finished reply");
    expect(pacer.backlog).toBe(0);
    expect(pacer.flush()).toBeNull();
  });

  it("commits a runaway backlog whole instead of animating it", () => {
    const pacer = new StreamPacer();
    const text = "y".repeat(5000);
    pacer.push(text);
    expect(pacer.tick(0)).toBe(text);
  });

  it("streams a retracted tail from the common prefix", () => {
    const pacer = new StreamPacer();
    pacer.push("see telo://chat/1/2");
    pacer.flush();
    pacer.push("see ");
    expect(pacer.text).toBe("see ");
    pacer.push("see [msg](telo://chat/1/2)");
    expect(pacer.backlog).toBe("[msg](telo://chat/1/2)".length);
  });

  it("does not bank budget while idle", () => {
    const pacer = new StreamPacer();
    pacer.push("a");
    pacer.tick(0);
    pacer.tick(1000);
    pacer.tick(2000);
    pacer.push("abcdefghijklmnop");
    // Elapsed since the last tick is capped, so the burst is bounded.
    expect(pacer.tick(2016)?.length ?? 1).toBeLessThanOrEqual(3);
  });
});
