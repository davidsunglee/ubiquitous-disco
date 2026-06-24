import type { Actor } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";
import { applyHit } from "./hit";

/**
 * Strike: tap / hold-to-charge / directional shaping / upward pop.
 *
 * While `strikeHeld`, the actor's `charge` accumulator increases by one tick,
 * clamped to [minChargeTicks, maxChargeTicks]. On `strikeReleased` the charge is
 * normalized to [0, 1], used to lerp the impulse magnitude between min and max,
 * and the impulse vector is snapshotted onto the actor for the 3-tick active
 * window. The window resolves against the ball on the release tick AND up to 2
 * grace ticks — one ball-hit per swing. A bare tap still connects immediately if
 * the ball is in reach on the release tick (window tick 1).
 *
 * FLI-11: replaced the single-tick ball contact with a 3-tick active window so
 * aerial contacts are forgiving. Player-vs-player knockback stays release-tick-only.
 */
/**
 * Strike: tap / hold-to-charge / directional shaping / upward pop.
 *
 * Extended in Phase 3 to also resolve against other player slots:
 * - Ball connection behavior is unchanged.
 * - After ball check, each OTHER slot's position is tested against the same
 *   reach circle (plus playerHitRadius). Hits apply knockback to the target's
 *   JS-side vx/vy and accumulate stagger. Crossing staggerThreshold triggers
 *   Knockdown (controlLock set; knockdown event emitted by the sim, not here).
 * - Resolution is in slot order from start-of-tick positions, so a mutual
 *   trade lands for both.
 * - A knocked-down actor cannot initiate a strike but can still be hit.
 */
export function stepStrike(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  world: RapierWorld,
  slot: number,
  actors: Actor[],
): void {
  const s = config.strike;

  // Charge accumulates even while checking — charge clamped here.
  // Note: the caller (simulation.ts) is responsible for gating this function
  // using start-of-tick controllable state, so we do NOT re-check controllable
  // here. That ensures mutual-trade: a slot knocked down by an earlier strike
  // this tick can still have resolved its own strike (simulation.ts called us
  // when wasControllable[slot] was true at tick start).
  if (input.strikeHeld) {
    // Start at the tap floor on press, then accumulate, clamped to full charge.
    const base = actor.charge === 0 ? s.minChargeTicks : actor.charge + 1;
    actor.charge = Math.min(base, s.maxChargeTicks);
  }

  // ── On release: snapshot the impulse vector + open the 3-tick window ──
  if (input.strikeReleased) {
    // A tap that never registered held charge still counts as a min-charge Strike.
    const chargeTicks = Math.max(actor.charge, s.minChargeTicks);
    actor.charge = 0;

    // Charge fraction in [0, 1] across the configured charge window.
    const span = Math.max(1, s.maxChargeTicks - s.minChargeTicks);
    const t = Math.min(1, Math.max(0, (chargeTicks - s.minChargeTicks) / span));
    const minI = actor.character.stats.strikeMinImpulse;
    const maxI = actor.character.stats.strikeMaxImpulse;
    let magnitude = minI + (maxI - minI) * t;

    // Direction shaping: horizontal from move intent (fall back to facing), and an
    // always-present upward bias so a neutral Strike pops the ball up.
    let shapeX = input.moveX;
    if (shapeX === 0 && input.moveY === 0) shapeX = actor.facing;
    let shapeY = input.moveY + s.upwardBias;

    if (!actor.grounded) {
      if (input.moveY < 0) {
        // Spike: strong downward redirect — cancel the grounded upward pop, drive down.
        shapeY = input.moveY - s.upwardBias;
        magnitude *= s.spikeMultiplier;
      } else {
        // Header / air-redirect: preserve horizontal intent, add extra lift.
        shapeY = input.moveY + s.headerUpwardBias;
      }
    }

    const len = Math.hypot(shapeX, shapeY) || 1;
    actor.strikeImpulseX = (shapeX / len) * magnitude;
    actor.strikeImpulseY = (shapeY / len) * magnitude;
    actor.strikeActiveTicks = 3;

    // ── Player-vs-player knockback: RELEASE-TICK ONLY (unchanged) ──
    // INVARIANT (2v2 Friendly Fire): the target set is every non-self slot with
    // NO team filter — teammate Strikes connect at full strength by design.
    // Do not add same-team exclusion here (see match.test.ts FF coverage).
    // Resolved from start-of-tick positions (world.playerPos reads the current
    // kinematic position before this tick's move is applied). Both strikes in a
    // mutual trade are resolved independently, so both land.
    const player = world.playerPos(slot);
    const c = config.combat;
    const reach = actor.character.stats.strikeReach;
    for (let ti = 0; ti < actors.length; ti++) {
      if (ti === slot) continue;
      const target = actors[ti];
      if (!target) continue;
      // Anti-stunlock: a target is immune both while DOWN and during the recovery
      // i-frames that follow. Together this is a continuous "can't be re-knocked-down"
      // window (knockdown duration + invuln). Without the knockdown guard, mashing
      // hits on a grounded target keeps resetting knockdownTicks so they never reach
      // the stand-up edge that grants i-frames — a permanent stunlock.
      if (target.knockdownTicks > 0) continue; // already down: immune
      if (target.invulnTicks > 0) continue; // recovery i-frames: immune
      const tp = world.playerPos(ti);
      const dx = tp.x - player.x;
      const dy = tp.y - player.y;
      if (Math.hypot(dx, dy) > reach + c.playerHitRadius) continue; // out of reach

      // Knockback away from the striker (fall back to facing direction on exact overlap).
      const klen = Math.hypot(dx, dy) || 1;
      const nx = dx / klen;
      const ny = dy / klen;
      target.vx = nx * c.strikePlayerImpulse;
      // Give the target some upward momentum + horizontal knockback.
      target.vy = Math.max(
        target.vy,
        ny * c.strikePlayerImpulse * 0.5 + c.strikePlayerImpulse * 0.4,
      );

      // Shared hit tail: attribution + stagger + maybe knockdown. The knockdown
      // event is emitted by simulation.ts (it owns the event queue + tick).
      applyHit(target, slot, config);
    }
  }

  // ── Active-window ball resolution: runs every tick the window is live ──
  // (release tick is window tick 1; up to 2 grace ticks follow). One hit/swing.
  if (actor.strikeActiveTicks > 0) {
    const player = world.playerPos(slot);
    const ball = world.ballPos();
    const reach = actor.character.stats.strikeReach;
    if (Math.hypot(ball.x - player.x, ball.y - player.y) <= reach) {
      world.applyBallImpulse(actor.strikeImpulseX, actor.strikeImpulseY);
      actor.strikeActiveTicks = 0; // one ball-hit per swing
    } else {
      actor.strikeActiveTicks -= 1;
    }
  }
}
