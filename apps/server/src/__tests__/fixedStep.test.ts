import { expect, test } from "vitest";
import { FixedStepAccumulator } from "../fixedStep";

const STEP = 1000 / 30; // 33.333ms

test("first pump primes the clock and runs no steps", () => {
  const now = 1000;
  const acc = new FixedStepAccumulator(STEP, () => now);
  expect(acc.pump()).toBe(0);
});

test("runs steps based on real elapsed wall-clock time", () => {
  let now = 0;
  const acc = new FixedStepAccumulator(STEP, () => now);
  acc.pump(); // prime at t=0
  now = 100; // 100ms elapsed
  expect(acc.pump()).toBe(3); // floor(100 / 33.333) = 3
});

test("carries the remainder across pumps (no time is lost)", () => {
  let now = 0;
  const acc = new FixedStepAccumulator(STEP, () => now);
  acc.pump();
  now = 33;
  expect(acc.pump()).toBe(0); // 33 < 33.333
  now = 34;
  expect(acc.pump()).toBe(1); // total 34 → 1 step, remainder carried
});

test("advances exactly 30 steps per simulated second regardless of pump frequency", () => {
  let now = 0;
  const acc = new FixedStepAccumulator(STEP, () => now);
  acc.pump(); // prime
  let steps = 0;
  // Pump 200 times across 1000ms (every 5ms) — like a fast interval.
  for (let i = 1; i <= 200; i++) {
    now = i * 5;
    steps += acc.pump();
  }
  expect(steps).toBe(30);
});

test("regression: ignores any caller-provided delta — only wall-clock matters", () => {
  // Colyseus's clock.deltaTime can be corrupted (undercounted) when a competing
  // 60Hz clock.tick() interval runs. The accumulator must NOT trust it: pump()
  // takes no delta argument and reads wall-clock time itself. A full real
  // second must yield 30 steps, not ~12.
  let now = 0;
  const acc = new FixedStepAccumulator(STEP, () => now);
  acc.pump();
  now = 1000;
  expect(acc.pump()).toBe(30);
});
