import type { ArenaDef, CircleZone } from "../arena";

// Per-Bell debounce state. `armed` is true when the Bell is ready to ring (i.e.
// the ball is currently OUTSIDE its hit-zone). A ring fires on the entry edge and
// disarms; it re-arms only once the ball has left the zone again, so a single
// contact rings exactly once. This state persists across ticks and therefore
// affects future events — it is sim state and MUST be folded into the hash.
export interface BellRingState {
  // One byte per Bell, in arena Bell order (the determinism contract). true =
  // armed (ready to ring on next entry).
  armed: boolean[];
}

export function createBellRingState(arena: ArenaDef): BellRingState {
  return { armed: arena.bells.map(() => true) };
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
    const inside = circleOverlap(ballX, ballY, ballRadius, bell.hitZone);
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
 * order. Folded into the composite hash so two identical runs stay byte-stable
 * even though `armed` is JS-side sim state not captured by the Rapier snapshot.
 */
export function serializeBellRingState(state: BellRingState): Uint8Array {
  const buf = new Uint8Array(state.armed.length);
  for (let i = 0; i < state.armed.length; i++) {
    buf[i] = state.armed[i] ? 1 : 0;
  }
  return buf;
}
