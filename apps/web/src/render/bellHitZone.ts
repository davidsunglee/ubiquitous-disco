/**
 * Overtime Bell hit-zone render helper (FLI-9 Phase 6 — Overtime Pressure Ramp).
 *
 * During Golden Goal the sim grows each Bell's scoring radius (radiusBonus,
 * surfaced via `Simulation.getBellHitRadii()`). The static authored art does not
 * convey that, so the renderer draws an extra ring at the *effective* radius —
 * the visible hit-zone then tracks the scoring zone, satisfying the ticket
 * criterion that the zones "visibly grow during Golden Goal".
 *
 * Pure + deterministic (tick-driven pulse, no wall clock) so it is unit-testable
 * and stays in lock-step with the deterministic sim.
 */

import type { MatchPhase } from "@bb/sim";

/** Pulse band for the overtime ring's stroke alpha. */
export const OVERTIME_RING_MIN_ALPHA = 0.25;
export const OVERTIME_RING_MAX_ALPHA = 0.7;
/** Pulse period in sim ticks (triangle wave: trough → peak → trough). */
export const OVERTIME_RING_PULSE_PERIOD = 20;

export interface OvertimeBellRing {
  /** Hit-zone radius to stroke, in world units (the grown, effective radius). */
  radius: number;
  /** Stroke alpha in [MIN, MAX], pulsing with the sim tick for a pressure VFX. */
  alpha: number;
}

/**
 * Decide the overtime hit-zone ring to draw for a Bell this frame.
 *
 * @param phase           current match phase
 * @param effectiveRadius the Bell's effective hit radius (sim.getBellHitRadii())
 * @param tick            current sim tick (drives the deterministic pulse)
 * @returns the ring to stroke, or null outside Golden Goal (draw nothing extra)
 */
export function overtimeBellRing(
  phase: MatchPhase,
  effectiveRadius: number,
  tick: number,
): OvertimeBellRing | null {
  if (phase !== "goldenGoal") return null;
  const period = OVERTIME_RING_PULSE_PERIOD;
  // Normalised position within the period, 0..1 (guard negative ticks).
  const pos = (((tick % period) + period) % period) / period;
  // Triangle wave: 0 → 1 → 0 across the period.
  const tri = pos < 0.5 ? pos * 2 : 2 - pos * 2;
  const alpha =
    OVERTIME_RING_MIN_ALPHA +
    (OVERTIME_RING_MAX_ALPHA - OVERTIME_RING_MIN_ALPHA) * tri;
  return { radius: effectiveRadius, alpha };
}
