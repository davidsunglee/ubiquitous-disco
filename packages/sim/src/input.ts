// Protected input model + pure helpers. No Phaser, no pixels — Vitest-testable.
// Phaser adapters in apps/web only gather raw key/pointer state and call these.

export interface InputFrame {
  moveX: number; // analog, normalized to [-1, 1]
  moveY: number; // analog, normalized to [-1, 1]
  jumpHeld: boolean;
  dashHeld: boolean;
  strikeHeld: boolean;
  /** Phase 2: Special action held this tick. */
  specialHeld: boolean;
  jumpPressed: boolean; // edges derived from the previous frame
  dashPressed: boolean;
  strikePressed: boolean;
  strikeReleased: boolean;
  /** Phase 2: Special action pressed this tick (rising edge). */
  specialPressed: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  moveX: 0,
  moveY: 0,
  jumpHeld: false,
  dashHeld: false,
  strikeHeld: false,
  specialHeld: false,
  jumpPressed: false,
  dashPressed: false,
  strikePressed: false,
  strikeReleased: false,
  specialPressed: false,
};

/** Raw held-button snapshot for a single frame, before edge derivation. */
export interface HeldState {
  jump: boolean;
  dash: boolean;
  strike: boolean;
  /** Phase 2: Special action button held. */
  special: boolean;
}

export const EMPTY_HELD: HeldState = {
  jump: false,
  dash: false,
  strike: false,
  special: false,
};

export interface EdgeFlags {
  jumpPressed: boolean;
  dashPressed: boolean;
  strikePressed: boolean;
  strikeReleased: boolean;
  /** Phase 2: Special action pressed (rising edge). */
  specialPressed: boolean;
}

/**
 * Clamp the analog move vector to the unit disc so diagonals are not √2 faster
 * than cardinal directions. Inputs already inside the disc pass through.
 */
export function normalizeMove(
  x: number,
  y: number,
): { moveX: number; moveY: number } {
  const len = Math.hypot(x, y);
  if (len > 1) return { moveX: x / len, moveY: y / len };
  return { moveX: x, moveY: y };
}

/** Derive press/release edges by comparing the current held state to the previous one. */
export function deriveEdges(prev: HeldState, cur: HeldState): EdgeFlags {
  return {
    jumpPressed: cur.jump && !prev.jump,
    dashPressed: cur.dash && !prev.dash,
    strikePressed: cur.strike && !prev.strike,
    strikeReleased: !cur.strike && prev.strike,
    specialPressed: cur.special && !prev.special,
  };
}

/** Assemble a full InputFrame from a normalized move vector + held state + previous held state. */
export function buildInputFrame(
  move: { moveX: number; moveY: number },
  cur: HeldState,
  prev: HeldState,
): InputFrame {
  const edges = deriveEdges(prev, cur);
  return {
    moveX: move.moveX,
    moveY: move.moveY,
    jumpHeld: cur.jump,
    dashHeld: cur.dash,
    strikeHeld: cur.strike,
    specialHeld: cur.special,
    ...edges,
  };
}
