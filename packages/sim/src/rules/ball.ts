import type { Actor } from "../actor";
import type { SimConfig } from "../config";
import type { RapierWorld } from "../rapier-world";

/**
 * Per-tick ball maintenance. Gravity scale, restitution and linear damping are
 * configured on the body/collider at construction; this rule enforces the two
 * remaining config knobs that have to be applied each step:
 *
 *  - a speed clamp (`ball.maxSpeed`) so a fully-charged Strike can't fling the
 *    ball arbitrarily fast and break determinism-sensitive feel;
 *  - light player-body contact (`ball.playerPush`): when the player body is in
 *    contact range and moving toward the ball, give it a gentle shove so walking
 *    into the ball nudges it rather than the player simply sliding past.
 *
 * Call AFTER the Rapier step so the clamp acts on the integrated velocity.
 */
export function stepBall(
  actor: Actor,
  config: SimConfig,
  world: RapierWorld,
): void {
  // Light player-body contact: nudge the ball when the player is touching it and
  // pressing toward it. Kept gentle (capped at playerPush) so it reads as contact,
  // not a Strike.
  if (actor.vx !== 0) {
    const player = world.playerPos();
    const ball = world.ballPos();
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const contactRange = config.player.halfW + config.ball.radius + 0.15;
    if (
      Math.abs(dx) <= contactRange &&
      Math.abs(dy) <= config.player.halfH + config.ball.radius &&
      Math.sign(dx) === Math.sign(actor.vx)
    ) {
      const push = config.ball.playerPush * Math.sign(actor.vx);
      const v = world.ballVel();
      // Only assist up to the push speed; never slow a faster-moving ball.
      if (
        Math.abs(v.x) < Math.abs(push) ||
        Math.sign(v.x) !== Math.sign(push)
      ) {
        world.setBallVel(push, v.y);
      }
    }
  }

  // Speed clamp.
  const v = world.ballVel();
  const speed = Math.hypot(v.x, v.y);
  const max = config.ball.maxSpeed;
  if (speed > max) {
    const k = max / speed;
    world.setBallVel(v.x * k, v.y * k);
  }
}
