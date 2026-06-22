import type { Actor } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";

/**
 * Strike: tap / hold-to-charge / directional shaping / upward pop.
 *
 * While `strikeHeld`, the actor's `charge` accumulator increases by one tick,
 * clamped to [minChargeTicks, maxChargeTicks]. On `strikeReleased` the charge is
 * normalized to [0, 1], used to lerp the impulse magnitude between min and max,
 * and applied to the ball along a direction shaped by `moveX/moveY` plus a
 * configurable upward bias (the "pop"). A bare tap (press+release in one tick,
 * never charged) still lands as a min-charge Strike.
 *
 * The Strike only connects when the ball is within `strike.reach` of the player;
 * either way the charge resets afterward.
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

  if (!input.strikeReleased) return;

  // A tap that never registered held charge still counts as a min-charge Strike.
  const chargeTicks = Math.max(actor.charge, s.minChargeTicks);
  actor.charge = 0;

  const player = world.playerPos(slot);

  // ── Ball connection ──
  const ball = world.ballPos();
  const bdx = ball.x - player.x;
  const bdy = ball.y - player.y;
  const reach = actor.character.stats.strikeReach;
  if (Math.hypot(bdx, bdy) <= reach) {
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
    const nx = shapeX / len;
    const ny = shapeY / len;

    world.applyBallImpulse(nx * magnitude, ny * magnitude);
  }

  // ── Player connection: deterministic geometry overlap vs each OTHER slot ──
  // INVARIANT (2v2 Friendly Fire): the target set is every non-self slot with
  // NO team filter — teammate Strikes connect at full strength by design.
  // Do not add same-team exclusion here (see match.test.ts FF coverage).
  // Resolved from start-of-tick positions (world.playerPos reads the current
  // kinematic position before this tick's move is applied). Both strikes in a
  // mutual trade are resolved independently, so both land.
  const c = config.combat;
  for (let t = 0; t < actors.length; t++) {
    if (t === slot) continue;
    const target = actors[t];
    if (!target) continue;
    // Anti-stunlock: a target is immune both while DOWN and during the recovery
    // i-frames that follow. Together this is a continuous "can't be re-knocked-down"
    // window (knockdown duration + invuln). Without the knockdown guard, mashing
    // hits on a grounded target keeps resetting knockdownTicks so they never reach
    // the stand-up edge that grants i-frames — a permanent stunlock.
    if (target.knockdownTicks > 0) continue; // already down: immune
    if (target.invulnTicks > 0) continue; // recovery i-frames: immune
    const tp = world.playerPos(t);
    const dx = tp.x - player.x;
    const dy = tp.y - player.y;
    if (Math.hypot(dx, dy) > reach + c.playerHitRadius) continue; // out of reach

    // Knockback away from the striker (fall back to facing direction on exact overlap).
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    target.vx = nx * c.strikePlayerImpulse;
    // Give the target some upward momentum + horizontal knockback.
    target.vy = Math.max(
      target.vy,
      ny * c.strikePlayerImpulse * 0.5 + c.strikePlayerImpulse * 0.4,
    );

    target.stagger += c.staggerPerHit;
    // Refresh the grace window so stagger holds (doesn't decay) between the hits
    // of an exchange — this makes Knockdown depend on hit COUNT, not hit timing.
    target.staggerDecayDelay = c.staggerGraceTicks;
    if (target.stagger >= c.staggerThreshold) {
      target.knockdownTicks = c.knockdownDurationTicks;
      target.controlLock = true;
      target.stagger = 0;
      // The knockdown event is emitted by simulation.ts (it owns the event queue + tick).
    }
  }
}
