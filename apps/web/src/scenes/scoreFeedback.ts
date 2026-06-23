/**
 * Map an authoritative Team-score increment to the Bell that rang.
 *
 * Scoring credits the OPPOSING Team, so a Bell Ring at one Bell increments the other
 * Team's score (see simulation.ts Bell Ring pass):
 *   - scores[0]++  ⟺  the RIGHT Bell rang  (Team 0 scored)
 *   - scores[1]++  ⟺  the LEFT  Bell rang  (Team 1 scored)
 *
 * Driving the Bell banner from authoritative scores (instead of the client's
 * predicted sim events) means it fires exactly once per real Bell Ring on every
 * client — including networked play, where predicted sim events are discarded.
 *
 * Returns null when no Team's score increased (no change, or a reset/rematch
 * decrement). A missing entry is treated as 0 so the first Bell Ring still registers.
 */
export function bellFromScoreDelta(
  prev: readonly number[],
  next: readonly number[],
): "left" | "right" | null {
  if ((next[0] ?? 0) > (prev[0] ?? 0)) return "right";
  if ((next[1] ?? 0) > (prev[1] ?? 0)) return "left";
  return null;
}
