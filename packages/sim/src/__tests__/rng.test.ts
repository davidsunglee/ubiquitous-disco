/**
 * Phase 3 (FLI-9): rng.ts — pure integer PRNG tests.
 *
 * Covers:
 *  1. Same seed → same sequence.
 *  2. Different seed → different sequence.
 *  3. Integer-state purity: no Math.random involvement (the state advances
 *     deterministically and the PRNG works without Math.random being available).
 *  4. Values are in [0, 1).
 *  5. State advances each call (sequence is not constant).
 */

import { expect, test } from "vitest";
import { nextRng, seedRng } from "../rng";

// ── Same seed → same sequence ─────────────────────────────────────────────────

test("same seed produces the same sequence of values", () => {
  const seed = 42;
  const s1 = seedRng(seed);
  const s2 = seedRng(seed);

  const r1a = nextRng(s1);
  const r2a = nextRng(s2);
  expect(r1a.value).toBe(r2a.value);
  expect(r1a.state).toBe(r2a.state);

  const r1b = nextRng(r1a.state);
  const r2b = nextRng(r2a.state);
  expect(r1b.value).toBe(r2b.value);
  expect(r1b.state).toBe(r2b.state);

  // Five draws must be identical
  let st1 = seedRng(seed);
  let st2 = seedRng(seed);
  for (let i = 0; i < 5; i++) {
    const ra = nextRng(st1);
    const rb = nextRng(st2);
    expect(ra.value).toBe(rb.value);
    st1 = ra.state;
    st2 = rb.state;
  }
});

// ── Different seed → different sequence ──────────────────────────────────────

test("different seeds produce different sequences", () => {
  const s1 = seedRng(1);
  const s2 = seedRng(2);

  const r1 = nextRng(s1);
  const r2 = nextRng(s2);
  expect(r1.value).not.toBe(r2.value);
});

test("seed 0 and seed 1 produce different first values", () => {
  const r0 = nextRng(seedRng(0));
  const r1 = nextRng(seedRng(1));
  expect(r0.value).not.toBe(r1.value);
});

// ── Integer-state purity (no Math.random) ────────────────────────────────────

test("PRNG produces deterministic results without Math.random", () => {
  // Temporarily disable Math.random to confirm the PRNG never calls it.
  const originalRandom = Math.random;
  let called = false;
  Math.random = () => {
    called = true;
    return 0;
  };

  try {
    let state = seedRng(12345);
    for (let i = 0; i < 10; i++) {
      const r = nextRng(state);
      state = r.state;
      // Should still produce valid [0,1) values.
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
    }
    expect(called).toBe(false);
  } finally {
    Math.random = originalRandom;
  }
});

// ── Values are in [0, 1) ─────────────────────────────────────────────────────

test("all drawn values are in [0, 1)", () => {
  let state = seedRng(99999);
  for (let i = 0; i < 1000; i++) {
    const r = nextRng(state);
    state = r.state;
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThan(1);
  }
});

// ── State advances each call ─────────────────────────────────────────────────

test("consecutive draws produce different values (sequence is not constant)", () => {
  let state = seedRng(7777);
  const values: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = nextRng(state);
    values.push(r.value);
    state = r.state;
  }
  // Not all values are the same (with overwhelming probability for a good PRNG).
  const unique = new Set(values);
  expect(unique.size).toBeGreaterThan(1);
});

// ── seedRng normalises to Uint32 ─────────────────────────────────────────────

test("seedRng clamps to Uint32 (no negative states)", () => {
  const s = seedRng(-1);
  // -1 >>> 0 == 4294967295 (all-ones Uint32)
  expect(s).toBe(4294967295);
  expect(s).toBeGreaterThanOrEqual(0);
});

test("seedRng(0) produces a valid state", () => {
  const s = seedRng(0);
  expect(s).toBe(0);
  const r = nextRng(s);
  expect(r.value).toBeGreaterThanOrEqual(0);
  expect(r.value).toBeLessThan(1);
});
