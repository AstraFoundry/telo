import { describe, expect, it } from "vitest";

import { countHash, countStickersHash } from "./sticker-hash";

describe("countHash", () => {
  it("hashes an empty range to the initial accumulator", () => {
    // HashInit() is 0 and nothing updates it.
    expect(countHash([])).toBe(0n);
  });

  it("adds the first value to an untouched accumulator", () => {
    // Every shift of 0 is 0, so the three xors leave the accumulator at 0 and
    // only the addition contributes.
    expect(countHash([1n])).toBe(1n);
  });

  it("runs the shift-xor mixing before adding the next value", () => {
    // Hand-computed from already = 1:
    //   1 ^ (1 >> 21)  = 1
    //   1 ^ (1 << 35)  = 2^35 + 1               = 34359738369
    //   that ^ (that >> 4) = 2^35 + 2^31 + 1    = 36507222017
    //   + 2                                     = 36507222019
    expect(countHash([1n, 2n])).toBe(36507222019n);
  });

  it("truncates the left shift at 64 bits", () => {
    // Hand-computed from already = 2^33, with a zero value so only the
    // mixing shows:
    //   2^33 ^ (2^33 >> 21)  = 2^33 + 2^12          = 0x2_0000_1000
    //   << 35 sets bits 68 and 47; bit 68 falls off  = 0x8002_0000_1000
    //   that ^ (that >> 4)                           = 149542708187392
    expect(countHash([1n << 33n, 0n])).toBe(149542708187392n);
  });

  it("wraps the addition at 64 bits", () => {
    // Adding 2^64 - 1 to the 36507222017 the mixing produced is subtracting
    // one from it.
    expect(countHash([1n, 0xffffffffffffffffn])).toBe(36507222016n);
  });

  it("folds three values in order", () => {
    expect(countHash([1n, 2n, 3n])).toBe(565224272838726n);
    // Order matters: the same values mixed differently land elsewhere.
    expect(countHash([3n, 2n, 1n])).not.toBe(565224272838726n);
  });
});

describe("countStickersHash", () => {
  it("hashes each set's own hash field in the listed order", () => {
    expect(countStickersHash([{ hash: 1 }, { hash: 2 }])).toBe(36507222019n);
  });

  it("skips archived sets, which the server leaves out of its own hash", () => {
    expect(countStickersHash([{ hash: 1 }, { hash: 9, archived: true }])).toBe(
      1n,
    );
  });

  it("sign-extends a negative set hash to 64 bits", () => {
    // C++ assigns the signed TL int to a uint64, so -5 contributes
    // 2^64 - 5 = 18446744073709551611.
    expect(countStickersHash([{ hash: -5 }])).toBe(18446744073709551611n);
    expect(countStickersHash([{ hash: 7 }, { hash: -5 }])).toBe(255550554114n);
  });

  it("hashes an account with no installed sets to zero", () => {
    // Which is the hash a fresh client sends, and the one the server answers
    // allStickersNotModified to when the account really has no sets.
    expect(countStickersHash([])).toBe(0n);
  });
});
