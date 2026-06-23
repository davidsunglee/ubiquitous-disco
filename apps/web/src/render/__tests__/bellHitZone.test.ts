/**
 * Overtime Bell hit-zone render helper (FLI-9 Phase 6).
 *
 * The sim grows the Bell hit-zone radius during Golden Goal (getBellHitRadii()).
 * This pure helper decides what the renderer draws so the *visible* hit-zone
 * tracks the *scoring* radius — satisfying the ticket criterion that the zones
 * "visibly grow during Golden Goal".
 */

import { describe, expect, test } from "vitest";
import {
  OVERTIME_RING_MAX_ALPHA,
  OVERTIME_RING_MIN_ALPHA,
  OVERTIME_RING_PULSE_PERIOD,
  overtimeBellRing,
} from "../bellHitZone";

describe("overtimeBellRing", () => {
  test("returns null outside Golden Goal (no overtime ring drawn)", () => {
    expect(overtimeBellRing("playing", 1.5, 0)).toBeNull();
    expect(overtimeBellRing("preRound", 1.5, 10)).toBeNull();
    expect(overtimeBellRing("complete", 2.0, 5)).toBeNull();
  });

  test("during Golden Goal draws the grown (effective) radius, not the base", () => {
    // effectiveRadius comes from sim.getBellHitRadii() = base + radiusBonus.
    const ring = overtimeBellRing("goldenGoal", 2.3, 0);
    expect(ring).not.toBeNull();
    expect(ring?.radius).toBe(2.3);
  });

  test("the ring alpha pulses deterministically with the sim tick", () => {
    const trough = overtimeBellRing("goldenGoal", 1, 0);
    const peak = overtimeBellRing(
      "goldenGoal",
      1,
      OVERTIME_RING_PULSE_PERIOD / 2,
    );
    expect(trough?.alpha).toBeCloseTo(OVERTIME_RING_MIN_ALPHA, 5);
    expect(peak?.alpha).toBeCloseTo(OVERTIME_RING_MAX_ALPHA, 5);
  });

  test("alpha stays within the configured band across a full period", () => {
    for (let t = 0; t < OVERTIME_RING_PULSE_PERIOD * 2; t++) {
      const ring = overtimeBellRing("goldenGoal", 1, t);
      expect(ring).not.toBeNull();
      const a = ring?.alpha ?? -1;
      expect(a).toBeGreaterThanOrEqual(OVERTIME_RING_MIN_ALPHA - 1e-9);
      expect(a).toBeLessThanOrEqual(OVERTIME_RING_MAX_ALPHA + 1e-9);
    }
  });
});
