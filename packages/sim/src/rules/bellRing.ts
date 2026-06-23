import type { ArenaDef, CircleZone } from "../arena";
import type { SimConfig } from "../config";

// Per-Bell debounce state. `armed` is true when the Bell is ready to ring (i.e.
// the ball is currently OUTSIDE its hit-zone). A ring fires on the entry edge and
// disarms; it re-arms only once the ball has left the zone again, so a single
// contact rings exactly once. This state persists across ticks and therefore
// affects future events — it is sim state and MUST be folded into the hash.
export interface BellRingState {
  // One byte per Bell, in arena Bell order (the determinism contract). true =
  // armed (ready to ring on next entry).
  armed: boolean[];
  /** Extra hit-zone radius (world units) added during Golden Goal. Capped. Hashed. */
  radiusBonus: number;
  /** Ticks accumulated toward the next ramp step (Golden Goal only). */
  rampTicks: number;
}

export function createBellRingState(arena: ArenaDef): BellRingState {
  return { armed: arena.bells.map(() => true), radiusBonus: 0, rampTicks: 0 };
}

/** Circle-vs-circle overlap: the ball (center + radius) against a hit-zone. */
export function circleOverlap(
  ballX: number,
  ballY: number,
  ballRadius: number,
  zone: CircleZone,
): boolean {
  const dx = ballX - zone.x;
  const dy = ballY - zone.y;
  const r = ballRadius + zone.radius;
  return dx * dx + dy * dy <= r * r;
}

// A Bell that rang this tick (entry edge). `index` is the Bell's position in the
// arena array; `bell` is its id.
export interface BellHit {
  index: number;
  bell: "left" | "right";
}

/**
 * Pure, Rapier-independent Bell Ring detection. Tests the ball circle against
 * each Bell hit-zone in arena order; on the entry edge (ball was outside, now
 * inside) it records a hit and disarms the Bell. The Bell re-arms once the ball
 * leaves its zone. Mutates `state.armed` in place (deterministic) and returns the
 * Bells that rang this tick.
 */
export function stepBellRing(
  arena: ArenaDef,
  ballX: number,
  ballY: number,
  ballRadius: number,
  state: BellRingState,
): BellHit[] {
  const hits: BellHit[] = [];
  for (let i = 0; i < arena.bells.length; i++) {
    const bell = arena.bells[i];
    if (!bell) continue;
    const inside = circleOverlap(ballX, ballY, ballRadius, {
      ...bell.hitZone,
      radius: bell.hitZone.radius + state.radiusBonus,
    });
    if (inside && state.armed[i]) {
      state.armed[i] = false;
      hits.push({ index: i, bell: bell.id });
    } else if (!inside && !state.armed[i]) {
      state.armed[i] = true;
    }
  }
  return hits;
}

/**
 * Serialize the Bell debounce state for hashing: one byte per Bell in array
 * order, followed by radiusBonus (f64, 8 bytes) and rampTicks (i32, 4 bytes).
 * Folded into the composite hash so two identical runs stay byte-stable
 * even though `armed` is JS-side sim state not captured by the Rapier snapshot.
 */
export function serializeBellRingState(state: BellRingState): Uint8Array {
  // Layout: [armed bytes ...] [radiusBonus f64 8 bytes] [rampTicks i32 4 bytes]
  const totalLen = state.armed.length + 8 + 4;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  for (let i = 0; i < state.armed.length; i++) {
    view.setUint8(i, state.armed[i] ? 1 : 0);
  }
  let o = state.armed.length;
  view.setFloat64(o, state.radiusBonus); // 8 bytes, big-endian
  o += 8;
  view.setInt32(o, state.rampTicks); // 4 bytes, big-endian
  return new Uint8Array(buf);
}

/**
 * Advance the overtime pressure ramp by one tick (called only during Golden Goal).
 * Grows radiusBonus by rampStepRadius every rampIntervalTicks, capped at rampMaxBonus.
 */
export function advancePressureRamp(
  state: BellRingState,
  config: SimConfig,
): void {
  state.rampTicks += 1;
  if (state.rampTicks >= config.overtime.rampIntervalTicks) {
    state.rampTicks = 0;
    state.radiusBonus = Math.min(
      config.overtime.rampMaxBonus,
      state.radiusBonus + config.overtime.rampStepRadius,
    );
  }
}
