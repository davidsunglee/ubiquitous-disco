/**
 * stepSpecial — Phase 2/3 (FLI-9): cooldown Special rule.
 *
 * Called once per slot per tick from simulation.ts, AFTER stepStrike, gated by
 * the same start-of-tick wasControllable[s] guard.
 *
 * Decrement specialCooldown every tick (always, even while knocked down — so the
 * cooldown drains during recovery). Gate activation on: controllable, specialPressed,
 * and specialCooldown === 0. On activation, set specialCooldown = cooldownTicks and
 * dispatch by special.kind.
 *
 * Currently implemented: "ground-pound" (Panda), "stagger-stumble" (Drunken Boxer).
 * All other kinds fall through to `default: break` (no-op placeholder until Phase 4).
 *
 * Phase 3: gains an optional `draw` function that advances the sim-wide seeded
 * PRNG and returns a [0,1) float. Only Drunken Boxer's stagger-stumble consumes it.
 * The draw ORDER is fixed and identical on both engines — that is what keeps it
 * deterministic. The default (undefined) preserves Phase-2 behavior for all other
 * Specials.
 */

import { type Actor, controllable } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";

export function stepSpecial(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  rw: RapierWorld,
  slot: number,
  actors: Actor[],
  draw?: () => number,
): void {
  // Cooldown drains every tick regardless of controllable state.
  if (actor.specialCooldown > 0) actor.specialCooldown -= 1;

  // Activation gates: must be controllable, pressing special this tick, and cooldown ready.
  if (!controllable(actor)) return;
  if (!input.specialPressed || actor.specialCooldown > 0) return;

  const special = actor.character.special;
  // Set cooldown immediately so the activation itself is idempotent.
  actor.specialCooldown = special.cooldownTicks;

  switch (special.kind) {
    case "ground-pound": {
      const radius = special.params.radius ?? 3;
      const punt = special.params.ballPunt ?? 14;

      // Drive actor downward hard (dive). Resolves this tick as a placeholder slam.
      actor.vy = Math.min(actor.vy, -Math.abs(config.movement.jumpSpeed));

      const p = rw.playerPos(slot);

      // Radial knockback to other slots (no team filter — FF parity with strike).
      for (let t = 0; t < actors.length; t++) {
        if (t === slot) continue;
        const target = actors[t];
        if (!target) continue;
        // Anti-stunlock: skip already-down or recovery i-frames targets.
        if (target.knockdownTicks > 0 || target.invulnTicks > 0) continue;
        const tp = rw.playerPos(t);
        const dx = tp.x - p.x;
        const dy = tp.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const nx = d ? dx / d : actor.facing;
        const ny = d ? dy / d : 0.4;
        target.vx = nx * config.combat.strikePlayerImpulse;
        target.vy = Math.max(
          target.vy,
          ny * config.combat.strikePlayerImpulse * 0.5 +
            config.combat.strikePlayerImpulse * 0.5,
        );
        target.stagger += config.combat.staggerPerHit;
        target.staggerDecayDelay = config.combat.staggerGraceTicks;
        if (target.stagger >= config.combat.staggerThreshold) {
          target.knockdownTicks = config.combat.knockdownDurationTicks;
          target.controlLock = true;
          target.stagger = 0;
          // knockdown event emitted by simulation.ts (owns event queue + wasDown snapshot)
        }
      }

      // Punt the ball if it is within radius (outward + up).
      const ball = rw.ballPos();
      const bx = ball.x - p.x;
      const by = ball.y - p.y;
      if (Math.hypot(bx, by) <= radius) {
        const len = Math.hypot(bx, by) || 1;
        rw.applyBallImpulse(
          (bx / len) * punt,
          Math.abs(by / len) * punt * 0.5 + punt * 0.4,
        );
      }
      break;
    }

    case "stagger-stumble": {
      if (!draw) break; // RNG required; no-op if absent
      const lungeMax = special.params.lungeMax ?? 5;
      const angle = draw() * Math.PI * 2; // seeded-random direction
      const mag = (0.5 + draw() * 0.5) * lungeMax; // seeded-random magnitude
      // Velocity-kick: apply the lunge as a direct velocity assignment.
      actor.vx = Math.cos(angle) * mag;
      actor.vy = Math.max(actor.vy, Math.abs(Math.sin(angle)) * mag * 0.5);
      // If the lunge overlaps the ball, redirect it on a seeded-random angle.
      const p = rw.playerPos(slot);
      const ball = rw.ballPos();
      if (
        Math.hypot(ball.x - p.x, ball.y - p.y) <=
        actor.character.stats.strikeReach + 0.5
      ) {
        const ba = draw() * Math.PI * 2;
        rw.applyBallImpulse(
          Math.cos(ba) * lungeMax * 2,
          Math.abs(Math.sin(ba)) * lungeMax * 2,
        );
      }
      break;
    }

    // Other kinds implemented in Phase 4.
    default:
      break;
  }
}
