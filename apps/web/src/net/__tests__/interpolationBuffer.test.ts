/**
 * InterpolationBuffer tests (Phase 3).
 *
 * Verifies:
 *  1. positionAtTick returns the nearest entry at or before tick.
 *  2. sample lerps between bracketing entries.
 *  3. Out-of-range (before first / after last) handling.
 *  4. Obsolete / eviction behavior.
 *  5. Duplicate ticks are handled gracefully.
 */

import { describe, expect, test } from "vitest";
import { InterpolationBuffer, type RemotePose } from "../InterpolationBuffer";

function pose(
  serverTick: number,
  x: number,
  y = 1,
  vx = 0,
  vy = 0,
  facing: 1 | -1 = 1,
): RemotePose {
  return { serverTick, x, y, vx, vy, facing };
}

describe("InterpolationBuffer.positionAtTick", () => {
  test("returns null when buffer is empty", () => {
    const buf = new InterpolationBuffer();
    expect(buf.positionAtTick(10)).toBeNull();
  });

  test("returns the entry exactly at tick", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 2.0));
    buf.push(pose(12, 4.0));
    const result = buf.positionAtTick(10);
    expect(result?.serverTick).toBe(10);
    expect(result?.x).toBeCloseTo(2.0, 5);
  });

  test("returns the nearest entry before tick", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 2.0));
    buf.push(pose(12, 4.0));
    // Tick 11 is between 10 and 12 — positionAtTick returns nearest ≤ tick.
    const result = buf.positionAtTick(11);
    expect(result?.serverTick).toBe(10);
    expect(result?.x).toBeCloseTo(2.0, 5);
  });

  test("returns nearest entry when tick is after all entries", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 2.0));
    buf.push(pose(12, 4.0));
    const result = buf.positionAtTick(20);
    expect(result?.serverTick).toBe(12);
    expect(result?.x).toBeCloseTo(4.0, 5);
  });

  test("returns first entry when tick is before all entries", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 2.0));
    buf.push(pose(12, 4.0));
    // All entries are after tick 5; returns the oldest as best approximation.
    const result = buf.positionAtTick(5);
    expect(result).not.toBeNull();
    expect(result?.x).toBeCloseTo(2.0, 5);
  });
});

describe("InterpolationBuffer.sample", () => {
  test("returns null when buffer is empty", () => {
    const buf = new InterpolationBuffer();
    expect(buf.sample(10)).toBeNull();
  });

  test("returns the single entry when buffer has one element", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 3.0, 1.0));
    const result = buf.sample(10);
    expect(result?.x).toBeCloseTo(3.0, 5);
    expect(result?.y).toBeCloseTo(1.0, 5);
  });

  test("lerps between two entries (midpoint)", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 0.0, 0.0));
    buf.push(pose(12, 4.0, 2.0));
    // At tick 11 (halfway between 10 and 12), expect x=2, y=1.
    const result = buf.sample(11);
    expect(result?.x).toBeCloseTo(2.0, 4);
    expect(result?.y).toBeCloseTo(1.0, 4);
  });

  test("lerps at t=0.25 (quarter-way between entries)", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 0.0));
    buf.push(pose(14, 8.0));
    // At tick 11 (1/4 of the way from 10 to 14), expect x = 2.0.
    const result = buf.sample(11);
    expect(result?.x).toBeCloseTo(2.0, 4);
  });

  test("clamps to first entry when renderTick is before all entries", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 5.0));
    buf.push(pose(12, 7.0));
    const result = buf.sample(5);
    expect(result?.x).toBeCloseTo(5.0, 5);
  });

  test("clamps to last entry when renderTick is after all entries", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 5.0));
    buf.push(pose(12, 7.0));
    const result = buf.sample(20);
    expect(result?.x).toBeCloseTo(7.0, 5);
  });

  test("facing snaps at t=0.5 threshold", () => {
    const buf = new InterpolationBuffer();
    // Entry at tick 10 faces right (+1), entry at tick 12 faces left (-1).
    buf.push({ serverTick: 10, x: 0, y: 1, vx: 0, vy: 0, facing: 1 });
    buf.push({ serverTick: 12, x: 2, y: 1, vx: 0, vy: 0, facing: -1 });
    // At tick 10 (t=0): facing = 1 (prev).
    expect(buf.sample(10)?.facing).toBe(1);
    // At tick 11 (t=0.5): facing = -1 (next).
    expect(buf.sample(11)?.facing).toBe(-1);
  });
});

describe("InterpolationBuffer eviction and duplicates", () => {
  test("ignores duplicate serverTick pushes (last write wins)", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 1.0));
    buf.push(pose(10, 9.0)); // duplicate — should overwrite
    expect(buf.size).toBe(1);
    expect(buf.positionAtTick(10)?.x).toBeCloseTo(9.0, 5);
  });

  test("maintains ascending order when pushed out of order", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(12, 4.0));
    buf.push(pose(10, 2.0));
    buf.push(pose(11, 3.0));
    // positionAtTick(11) should return the entry at tick 11 (x=3.0).
    expect(buf.positionAtTick(11)?.x).toBeCloseTo(3.0, 5);
    // sample(11) between 10 and 12 should interpolate correctly.
    const s = buf.sample(11);
    expect(s?.x).toBeCloseTo(3.0, 4);
  });

  test("evicts old entries when capacity is exceeded", () => {
    const buf = new InterpolationBuffer();
    // Push 65 entries (MAX_ENTRIES = 60; 5 should be evicted).
    for (let t = 0; t < 65; t++) {
      buf.push(pose(t, t * 0.1));
    }
    expect(buf.size).toBeLessThanOrEqual(60);
    // The oldest entries (ticks 0-4) should be evicted.
    // positionAtTick(0) falls back to the oldest remaining entry (not null),
    // but that oldest entry should be tick ≥ 5 — not the original tick 0 entry.
    const result = buf.positionAtTick(4);
    // The result should be the oldest surviving entry (tick=5 or later).
    // Its x value should be ≥ 0.5 (the x for tick=5 is 5*0.1=0.5).
    expect(result).not.toBeNull();
    expect(result?.serverTick).toBeGreaterThanOrEqual(5);
  });

  test("clear() empties the buffer", () => {
    const buf = new InterpolationBuffer();
    buf.push(pose(10, 1.0));
    buf.push(pose(12, 2.0));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.sample(10)).toBeNull();
  });
});
