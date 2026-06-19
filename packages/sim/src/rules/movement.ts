import type { Actor } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";
import type { DashBlink } from "./dash";

/**
 * Advance the player one fixed tick: horizontal move from `moveX`, variable-height
 * Jump (impulse on press, velocity cut on early `jumpHeld` release), gravity, and
 * collide-and-slide via the character controller. Grounded is read back from the
 * controller after the move and folds into coyote-time + landing detection.
 *
 * A Tele-Dash `blink` for this tick (or `null`) is folded into the SAME
 * collide-and-slide sweep, so the blink is clamped at first contact by the one
 * authoritative move — it can never re-penetrate geometry via a second move.
 *
 * All velocities are world units / second; the per-tick delta is `vel * dt`.
 */
export function stepMovement(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  world: RapierWorld,
  blink: DashBlink | null = null,
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

  // Single collide-and-slide for this tick: per-tick velocity plus any Tele-Dash
  // blink. Folding the blink in (rather than a separate teleport move) means it is
  // clamped at first contact and the held walk/jump velocity cannot then drive the
  // player further into the surface the blink stopped against. The blink sweep
  // excludes dynamic bodies so it passes the ball instead of shoving it.
  const dx = actor.vx * dt + (blink?.x ?? 0);
  const dy = actor.vy * dt + (blink?.y ?? 0);
  const result = world.movePlayer(dx, dy, blink !== null);

  // Reconcile velocity with what actually happened (walls/floor/ceiling stop us).
  // If blocked vertically (hit floor or ceiling) zero the vertical velocity so we
  // do not accumulate gravity into the ground or stick to a ceiling. On a blink
  // tick velocity is preserved (the blink is a reposition), so skip the ceiling
  // check — the large blink displacement makes `movedY` an unreliable bonk signal.
  if (result.grounded && actor.vy <= 0) {
    actor.vy = 0;
  } else if (!blink && actor.vy > 0 && result.movedY <= 1e-6) {
    // Rising but the controller absorbed the move → bonked a ceiling/overhang.
    actor.vy = 0;
  }

  // Grounded bookkeeping for coyote time.
  actor.grounded = result.grounded;
  actor.ticksSinceGrounded = result.grounded ? 0 : actor.ticksSinceGrounded + 1;
}
