/**
 * Shared hit resolution (FLI-9 cleanup #10).
 *
 * The Strike and every knockback Special share the same tail once a target is
 * confirmed hit: attribute the hit to the striker, accumulate Stagger, refresh
 * the decay grace window, and trigger a Knockdown when Stagger crosses the
 * threshold. That tail was inlined identically in five sites; centralising it
 * here keeps the hit model (FF gating, the #9 lastHitBy attribution, the stagger
 * curve, i-frames) in one place so changes can't silently diverge.
 *
 * Per-site targeting filters (reach circle / forward arc / blink band / radius)
 * and the knockback impulse itself stay at each call site — those are
 * intentionally tuned per move, not duplication.
 *
 * This is pure JS-side actor state. The knockdown event is emitted by
 * simulation.ts (which owns the event queue and the start-of-tick wasDown
 * snapshot), not here.
 */

import type { Actor } from "../actor";
import type { SimConfig } from "../config";

/**
 * Apply the shared Strike/Special hit tail to a confirmed-hit target.
 *
 * @param target       the actor that was hit (already passed the call site's filter)
 * @param strikerSlot  the slot that dealt the hit (recorded for FF attribution)
 * @param config       sim config (combat stagger/knockdown parameters)
 */
export function applyHit(
  target: Actor,
  strikerSlot: number,
  config: SimConfig,
): void {
  const c = config.combat;
  // Attribute this hit to the striker (Phase 7: event-only, not hashed) so the
  // sim's knockdown/playerHit events can report who dealt the blow.
  target.lastHitBy = strikerSlot;
  target.stagger += c.staggerPerHit;
  // Refresh the grace window so stagger holds (doesn't decay) between the hits
  // of an exchange — this makes Knockdown depend on hit COUNT, not hit timing.
  target.staggerDecayDelay = c.staggerGraceTicks;
  if (target.stagger >= c.staggerThreshold) {
    target.knockdownTicks = c.knockdownDurationTicks;
    target.controlLock = true;
    target.stagger = 0;
  }
}
