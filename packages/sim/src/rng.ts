/**
 * Pure integer mulberry32 PRNG for the sim.
 *
 * No Math.random — all state is a Uint32 integer, making the PRNG
 * bit-identical across V8/JSC and serializable into the sim hash.
 *
 * References: mulberry32 by Tommy Ettinger (public domain).
 */

/** Pure integer PRNG. Returns the next state + a [0,1) float derived from it. */
export function nextRng(state: number): { state: number; value: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: s, value };
}

/** Seed the PRNG state from the match seed (always a Uint32). */
export const seedRng = (seed: number): number => seed >>> 0;
