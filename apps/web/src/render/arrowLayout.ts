/**
 * Off-screen player arrow layout (Phase 5, FLI-9).
 *
 * Pure geometry — no Phaser — so it can be unit-tested under jsdom. Given the
 * viewport positions of the player subjects, decide which players are off the
 * left/right edge of the viewport and lay out their edge arrows:
 *
 *  - Each arrow shows a per-team player NUMBER (not the raw slot):
 *      slot 0 → "1", slot 1 → "2"  (left team)
 *      slot 2 → "1", slot 3 → "2"  (right team)
 *    i.e. number = (slot % 2) + 1.
 *  - Arrows pin to the very left or right edge of the viewport.
 *  - When several players are off the same side they STACK vertically, centred
 *    on the viewport mid-line, sorted by slot ascending so the order is always
 *    Team1-P1, Team1-P2, Team2-P1, Team2-P2 (top → bottom).
 */

export interface ArrowSubject {
  slot: number;
  team: number;
  /** Viewport-space position in pixels (0..width, 0..height). */
  vx: number;
  vy: number;
}

export interface ArrowLayoutItem {
  slot: number;
  team: number;
  /** Displayed player number within the team: (slot % 2) + 1. */
  number: number;
  side: "left" | "right";
  /** Anchor x (the edge the arrow tip pins to), viewport px. */
  x: number;
  /** Stacked centre y, viewport px. */
  y: number;
}

export interface ArrowLayoutOpts {
  /** Gap from the very edge of the viewport to the arrow tip (px). */
  edgeGap: number;
  /** Vertical spacing between stacked arrows on the same side (px). */
  stackSpacing: number;
}

export const DEFAULT_ARROW_OPTS: ArrowLayoutOpts = {
  edgeGap: 2,
  stackSpacing: 44,
};

/** The per-team player number shown on the arrow (1-based, not the slot). */
export const playerNumberForSlot = (slot: number): number => (slot % 2) + 1;

/**
 * Compute edge-arrow layout for the off-screen players.
 *
 * A player is off-screen when its viewport position falls outside
 * [0, width] × [0, height]. Off-screen players pin to the nearer horizontal
 * edge (left if in the left half, right otherwise) and stack vertically.
 */
export function computeOffscreenArrows(
  players: ArrowSubject[],
  viewport: { width: number; height: number },
  opts: ArrowLayoutOpts = DEFAULT_ARROW_OPTS,
): ArrowLayoutItem[] {
  const { width, height } = viewport;

  const offscreen = players.filter(
    (p) => p.vx < 0 || p.vx > width || p.vy < 0 || p.vy > height,
  );

  const out: ArrowLayoutItem[] = [];
  for (const side of ["left", "right"] as const) {
    const group = offscreen
      .filter((p) => (p.vx < width / 2 ? "left" : "right") === side)
      .sort((a, b) => a.slot - b.slot);

    const n = group.length;
    const x = side === "left" ? opts.edgeGap : width - opts.edgeGap;

    for (let i = 0; i < n; i++) {
      const p = group[i];
      if (!p) continue;
      // Centre the stack on the viewport mid-line; a single arrow sits at 50%.
      const y = height / 2 + (i - (n - 1) / 2) * opts.stackSpacing;
      out.push({
        slot: p.slot,
        team: p.team,
        number: playerNumberForSlot(p.slot),
        side,
        x,
        y,
      });
    }
  }
  return out;
}
