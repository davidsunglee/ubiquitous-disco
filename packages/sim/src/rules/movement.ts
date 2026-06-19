import type { Actor } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";

/**
 * Advance the player one fixed tick: horizontal move from `moveX`, variable-height
 * Jump (impulse on press, velocity cut on early `jumpHeld` release), gravity, and
 * collide-and-slide via the character controller. Grounded is read back from the
 * controller after the move and folds into coyote-time + landing detection.
 *
 * All velocities are world units / second; the per-tick delta is `vel * dt`.
 */
export function stepMovement(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  world: RapierWorld,
): void {
  const dt = 1 / config.tickHz;
  const m = config.movement;

  // Facing follows non-zero horizontal intent.
  if (input.moveX > 0) actor.facing = 1;
  else if (input.moveX < 0) actor.facing = -1;

  // Horizontal velocity is directly driven by analog input (snappy platformer feel).
  actor.vx = input.moveX * m.moveSpeed;

  // Jump: allowed while grounded or within the coyote-time grace window.
  const canJump = actor.grounded || actor.ticksSinceGrounded <= m.coyoteTicks;
  if (input.jumpPressed && canJump) {
    actor.vy = m.jumpSpeed;
    actor.grounded = false;
    actor.ticksSinceGrounded = m.coyoteTicks + 1; // consume the grace window
  }

  // Variable height: releasing Jump early while still rising cuts upward velocity.
  if (!input.jumpHeld && actor.vy > 0) {
    actor.vy *= m.jumpCutMultiplier;
  }

  // Gravity integrates vertical velocity (gravityY is negative).
  actor.vy += config.gravityY * m.gravityScale * dt;

  // Collide-and-slide for this tick's intended translation.
  const result = world.movePlayer(actor.vx * dt, actor.vy * dt);

  // Reconcile velocity with what actually happened (walls/floor/ceiling stop us).
  // If blocked vertically (hit floor or ceiling) zero the vertical velocity so we
  // do not accumulate gravity into the ground or stick to a ceiling.
  if (result.grounded && actor.vy <= 0) {
    actor.vy = 0;
  } else if (actor.vy > 0 && result.movedY <= 1e-6) {
    // Rising but the controller absorbed the move → bonked a ceiling/overhang.
    actor.vy = 0;
  }

  // Grounded bookkeeping for coyote time.
  actor.grounded = result.grounded;
  actor.ticksSinceGrounded = result.grounded ? 0 : actor.ticksSinceGrounded + 1;
}
