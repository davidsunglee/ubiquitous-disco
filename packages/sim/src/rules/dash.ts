import { type Actor, controllable } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";

/** A Tele-Dash blink displacement (world units) to fold into this tick's move. */
export interface DashBlink {
  x: number;
  y: number;
}

/**
 * Tele-Dash: an instantaneous, fixed-distance blink in the input direction (or
 * the actor's facing when there is no horizontal intent). No i-frames this phase.
 *
 * Gating:
 *  - a cooldown timer (`dashCooldown`) ticks down every step; a Dash is blocked
 *    while it is non-zero;
 *  - while airborne, exactly one air-dash is allowed per airtime
 *    (`airDashAvailable`), consumed on use and reset on landing (see resetDashOnLanding).
 *
 * Returns the blink displacement (or `null` when no Dash fires this tick). The
 * displacement is NOT applied here — it is folded into the single per-tick
 * collide-and-slide in `stepMovement`, so the blink is clamped against geometry
 * by the same sweep as walking and can never re-penetrate via a second move.
 */
export function stepDash(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
): DashBlink | null {
  // Cooldown always advances toward ready.
  if (actor.dashCooldown > 0) actor.dashCooldown -= 1;

  // A knocked-down actor cannot initiate a dash.
  if (!controllable(actor)) return null;

  if (!input.dashPressed) return null;
  if (actor.dashCooldown > 0) return null;

  // Air-dash budget: one per airtime while not grounded.
  if (!actor.grounded) {
    if (!actor.airDashAvailable) return null;
    actor.airDashAvailable = false;
  }

  // Direction: horizontal move intent dominates; otherwise blink toward facing.
  // Vertical intent contributes too (a deliberate up/down blink is allowed).
  let dirX = input.moveX;
  const dirY = input.moveY;
  if (dirX === 0 && dirY === 0) dirX = actor.facing;

  const len = Math.hypot(dirX, dirY);
  const nx = dirX / len;
  const ny = dirY / len;

  // In-flight velocity is preserved (the blink is a pure reposition); the air-dash
  // budget, not velocity, gates re-use.
  if (dirX > 0) actor.facing = 1;
  else if (dirX < 0) actor.facing = -1;

  actor.dashCooldown = config.dash.cooldownTicks;

  return { x: nx * config.dash.distance, y: ny * config.dash.distance };
}

/**
 * Restore the one-per-airtime air-dash budget when the actor is on the ground.
 * Called from movement after grounded is reconciled for the tick.
 */
export function resetDashOnLanding(actor: Actor): void {
  if (actor.grounded) actor.airDashAvailable = true;
}
