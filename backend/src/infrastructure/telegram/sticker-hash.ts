/**
 * Telegram's client-side list hash, the one `messages.getAllStickers` takes so
 * the server can answer `messages.allStickersNotModified` instead of the whole
 * installed list. The algorithm is not negotiable: the client must arrive at
 * the exact 64-bit value the server computes over the same list, so this is a
 * literal port of Telegram Desktop's
 * `.workspace/reference/tdesktop/Telegram/SourceFiles/api/api_hash.h:36-70`
 * (`HashInit`/`HashUpdate`/`HashFinalize`) and of `CountStickersOrderHash` in
 * `.workspace/reference/tdesktop/Telegram/SourceFiles/api/api_hash.cpp:38-61`.
 */

/**
 * `HashUpdate(uint64 &already, uint64 value)`. C++ runs this in wrapping
 * 64-bit arithmetic; `BigInt` is unbounded, so the two steps that can widen
 * the accumulator — the left shift and the addition — are masked back to 64
 * bits. The right shifts only ever narrow it, so they need no mask.
 */
function hashUpdate(already: bigint, value: bigint): bigint {
  let next = already ^ (already >> 21n);
  next = BigInt.asUintN(64, next ^ (next << 35n));
  next = next ^ (next >> 4n);
  return BigInt.asUintN(64, next + value);
}

/** `CountHash(IntRange)` — folds a sequence of 64-bit values into one hash. */
export function countHash(values: Iterable<bigint>): bigint {
  // `HashInit()` is 0.
  let result = 0n;
  for (const value of values) {
    result = hashUpdate(result, BigInt.asUintN(64, value));
  }
  // `HashFinalize` is the identity at this schema layer: the request field is
  // a TL `long`, so the whole 64-bit accumulator goes on the wire. (Older
  // layers truncated it, back when the field was an `int`; it no longer is.)
  return result;
}

/**
 * What a set contributes to the hash. Structural on purpose, so the hash can
 * be computed from teleproto's `Api.StickerSet` without importing it.
 */
export interface StickerSetHashFacts {
  /** `stickerSet.hash`, a signed 32-bit TL `int`. */
  readonly hash: number;
  /** `stickerSet.archived`: the set sits in the account's archive. */
  readonly archived?: boolean;
}

/**
 * `CountStickersOrderHash`: hash each installed set's own `hash` field, in the
 * order Telegram lists them, skipping archived sets.
 *
 * tdesktop also skips its `Special` sets and bails out on `DefaultSetId`;
 * neither is reachable here. Both name locally synthesised sets — recent,
 * faved, the legacy default pack — that live only in tdesktop's own set map
 * and never appear in a `messages.allStickers` answer, which is the only
 * input this function is given.
 */
export function countStickersHash(
  sets: ReadonlyArray<StickerSetHashFacts>,
): bigint {
  return countHash(
    sets
      .filter((set) => !set.archived)
      // C++ widens the signed `int` field to `uint64`, which sign-extends a
      // negative hash; `asUintN` reproduces that bit pattern exactly.
      .map((set) => BigInt.asUintN(64, BigInt(set.hash))),
  );
}
