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
export function stepStrike(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  world: RapierWorld,
): void {
  const s = config.strike;

  if (input.strikeHeld) {
    // Start at the tap floor on press, then accumulate, clamped to full charge.
    const base = actor.charge === 0 ? s.minChargeTicks : actor.charge + 1;
    actor.charge = Math.min(base, s.maxChargeTicks);
  }

  if (!input.strikeReleased) return;

  // A tap that never registered held charge still counts as a min-charge Strike.
  const chargeTicks = Math.max(actor.charge, s.minChargeTicks);
  actor.charge = 0;

  const player = world.playerPos();
  const ball = world.ballPos();
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  if (Math.hypot(dx, dy) > s.reach) return; // out of reach — no connection

  // Charge fraction in [0, 1] across the configured charge window.
  const span = Math.max(1, s.maxChargeTicks - s.minChargeTicks);
  const t = Math.min(1, Math.max(0, (chargeTicks - s.minChargeTicks) / span));
  const magnitude = s.minImpulse + (s.maxImpulse - s.minImpulse) * t;

  // Direction shaping: horizontal from move intent (fall back to facing), and an
  // always-present upward bias so a neutral Strike pops the ball up.
  let shapeX = input.moveX;
  if (shapeX === 0 && input.moveY === 0) shapeX = actor.facing;
  const shapeY = input.moveY + s.upwardBias;

  const len = Math.hypot(shapeX, shapeY) || 1;
  const nx = shapeX / len;
  const ny = shapeY / len;

  world.applyBallImpulse(nx * magnitude, ny * magnitude);
}
