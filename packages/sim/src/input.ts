// Protected input model + pure helpers. No Phaser, no pixels — Vitest-testable.
// Phaser adapters in apps/web only gather raw key/pointer state and call these.

export interface InputFrame {
  moveX: number; // analog, normalized to [-1, 1]
  moveY: number; // analog, normalized to [-1, 1]
  jumpHeld: boolean;
  dashHeld: boolean;
  strikeHeld: boolean;
  jumpPressed: boolean; // edges derived from the previous frame
  dashPressed: boolean;
  strikePressed: boolean;
  strikeReleased: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  moveX: 0,
  moveY: 0,
  jumpHeld: false,
  dashHeld: false,
  strikeHeld: false,
  jumpPressed: false,
  dashPressed: false,
  strikePressed: false,
  strikeReleased: false,
};

/** Raw held-button snapshot for a single frame, before edge derivation. */
export interface HeldState {
  jump: boolean;
  dash: boolean;
  strike: boolean;
}

export const EMPTY_HELD: HeldState = {
  jump: false,
  dash: false,
  strike: false,
};

export interface EdgeFlags {
  jumpPressed: boolean;
  dashPressed: boolean;
  strikePressed: boolean;
  strikeReleased: boolean;
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
    ...edges,
  };
}
