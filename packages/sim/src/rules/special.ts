/**
 * stepSpecial — Phase 2/3/4 (FLI-9): cooldown Special rule.
 *
 * Called once per slot per tick from simulation.ts, AFTER stepStrike, gated by
 * the same start-of-tick wasControllable[s] guard.
 *
 * Decrement specialCooldown every tick (always, even while knocked down — so the
 * cooldown drains during recovery). Gate activation on: controllable, specialPressed,
 * and specialCooldown === 0. On activation, set specialCooldown = cooldownTicks and
 * dispatch by special.kind.
 *
 * Phase 2: "ground-pound" (Panda)
 * Phase 3: "stagger-stumble" (Drunken Boxer) — consumes the seeded PRNG via `draw`.
 * Phase 4: "palm-burst" (Sifu), "phantom-rush" (Vipra), "cloud-dash" (Monkey King),
 *          "repulse-field" (Old Master). Returns a SpecialBlink | null so that blink-style
 *          Specials (phantom-rush, cloud-dash) fold into the movement collide-and-slide.
 *
 * The draw ORDER is fixed and identical on both engines — that is what keeps it
 * deterministic. The default (undefined) preserves Phase-2 behavior for all other
 * Specials.
 */

import { type Actor, controllable } from "../actor";
import type { SimConfig } from "../config";
import type { InputFrame } from "../input";
import type { RapierWorld } from "../rapier-world";

/**
 * Blink displacement (world units) returned by blink-style Specials
 * (phantom-rush, cloud-dash). Folded into the movement collide-and-slide
 * by simulation.ts, matching the DashBlink pattern.
 */
export interface SpecialBlink {
  x: number;
  y: number;
}

export function stepSpecial(
  actor: Actor,
  input: InputFrame,
  config: SimConfig,
  rw: RapierWorld,
  slot: number,
  actors: Actor[],
  draw?: () => number,
): SpecialBlink | null {
  // Cooldown drains every tick regardless of controllable state.
  if (actor.specialCooldown > 0) actor.specialCooldown -= 1;

  // Activation gates: must be controllable, pressing special this tick, and cooldown ready.
  if (!controllable(actor)) return null;
  if (!input.specialPressed || actor.specialCooldown > 0) return null;

  const special = actor.character.special;
  // Characters with no Special ("none", e.g. Monkey King) consume neither the
  // press nor a cooldown — return before anything is mutated.
  if (special.kind === "none") return null;
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
      return null;
    }

    case "stagger-stumble": {
      if (!draw) return null; // RNG required; no-op if absent
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
      return null;
    }

    case "palm-burst": {
      // Sifu: short forward cone shove — moderate knockback to actors in front +
      // a forward ball impulse. Gated to a forward arc (dot product > 0).
      const impulse = special.params.impulse ?? 8;
      const reach = special.params.reach ?? 2.2;

      const p = rw.playerPos(slot);

      // Knockback all actors within reach that are in the forward arc.
      for (let t = 0; t < actors.length; t++) {
        if (t === slot) continue;
        const target = actors[t];
        if (!target) continue;
        if (target.knockdownTicks > 0 || target.invulnTicks > 0) continue;
        const tp = rw.playerPos(t);
        const dx = tp.x - p.x;
        const dy = tp.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > reach) continue;
        // Forward arc: dot of (dx, 0) with facing direction > 0.
        if (dx * actor.facing <= 0) continue;
        const nx = d ? dx / d : actor.facing;
        const ny = d ? dy / d : 0;
        target.vx = nx * impulse;
        target.vy = Math.max(
          target.vy,
          Math.abs(ny) * impulse * 0.4 + impulse * 0.3,
        );
        target.stagger += config.combat.staggerPerHit;
        target.staggerDecayDelay = config.combat.staggerGraceTicks;
        if (target.stagger >= config.combat.staggerThreshold) {
          target.knockdownTicks = config.combat.knockdownDurationTicks;
          target.controlLock = true;
          target.stagger = 0;
        }
      }

      // Forward ball impulse if in reach and in the forward arc.
      const ball = rw.ballPos();
      const bx = ball.x - p.x;
      const by = ball.y - p.y;
      if (Math.hypot(bx, by) <= reach && bx * actor.facing >= 0) {
        rw.applyBallImpulse(actor.facing * impulse, impulse * 0.2);
      }
      return null;
    }

    case "phantom-rush": {
      // Vipra: long fast horizontal blink — passes through opponents (staggering them)
      // and carries ball momentum. Returns a blink displacement for the movement sweep.
      const distance = special.params.distance ?? 8;

      // Blink direction: always horizontal, toward actor facing.
      const blinkX = actor.facing * distance;

      const p = rw.playerPos(slot);

      // Stagger any actor overlapping the blink path (simple: within reach of current pos).
      const halfDist = distance * 0.5;
      for (let t = 0; t < actors.length; t++) {
        if (t === slot) continue;
        const target = actors[t];
        if (!target) continue;
        if (target.knockdownTicks > 0 || target.invulnTicks > 0) continue;
        const tp = rw.playerPos(t);
        const dx = tp.x - p.x;
        const dy = tp.y - p.y;
        // Approximate blink-path overlap: target is within halfDist horizontally
        // in the blink direction and within 1.5 vertically.
        if (dx * actor.facing < 0 || Math.abs(dx) > halfDist + 1) continue;
        if (Math.abs(dy) > 1.5) continue;
        target.stagger += config.combat.staggerPerHit;
        target.staggerDecayDelay = config.combat.staggerGraceTicks;
        if (target.stagger >= config.combat.staggerThreshold) {
          target.knockdownTicks = config.combat.knockdownDurationTicks;
          target.controlLock = true;
          target.stagger = 0;
        }
      }

      // If ball is in the blink path, carry its momentum (forward impulse).
      const ball = rw.ballPos();
      const bx = ball.x - p.x;
      const by = ball.y - p.y;
      if (
        bx * actor.facing >= 0 &&
        Math.abs(bx) <= halfDist + 1 &&
        Math.abs(by) <= 1.5
      ) {
        rw.applyBallImpulse(actor.facing * distance * 0.8, 0);
      }

      return { x: blinkX, y: 0 };
    }

    case "cloud-dash": {
      // NOTE: currently unassigned — Monkey King's Special is disabled ("none").
      // Retained so it can be reattached by switching his special.kind back.
      // Monkey King: omni-directional air blink on a separate budget from the Tele-Dash.
      // Redirects the ball on overlap. Uses move direction for blink direction.
      const distance = special.params.distance ?? 4;

      // Direction: move input or actor facing if no input.
      let dirX = input.moveX;
      const dirY = input.moveY;
      if (dirX === 0 && dirY === 0) dirX = actor.facing;
      const len = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / len;
      const ny = dirY / len;

      const blinkX = nx * distance;
      const blinkY = ny * distance;

      // Update facing if horizontal component is non-zero.
      if (dirX > 0) actor.facing = 1;
      else if (dirX < 0) actor.facing = -1;

      // Redirect the ball if it is within reach after the blink.
      const p = rw.playerPos(slot);
      const ball = rw.ballPos();
      const bx = ball.x - p.x;
      const by = ball.y - p.y;
      // Approximate post-blink position for overlap check.
      const postX = p.x + blinkX;
      const postY = p.y + blinkY;
      const pbx = ball.x - postX;
      const pby = ball.y - postY;
      const ballReach = actor.character.stats.strikeReach + 0.5;
      if (
        Math.hypot(pbx, pby) <= ballReach ||
        Math.hypot(bx, by) <= ballReach
      ) {
        // Redirect: impulse in blink direction.
        rw.applyBallImpulse(nx * distance * 2, ny * distance * 2);
      }

      return { x: blinkX, y: blinkY };
    }

    case "repulse-field": {
      // Old Master: brief radial AoE pushing ball and opponents outward.
      const radius = special.params.radius ?? 3;
      const impulse = special.params.impulse ?? 9;

      const p = rw.playerPos(slot);

      // Push all actors outward.
      for (let t = 0; t < actors.length; t++) {
        if (t === slot) continue;
        const target = actors[t];
        if (!target) continue;
        if (target.knockdownTicks > 0 || target.invulnTicks > 0) continue;
        const tp = rw.playerPos(t);
        const dx = tp.x - p.x;
        const dy = tp.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const nx = d ? dx / d : t < slot ? -1 : 1;
        const ny = d ? dy / d : 0;
        target.vx = nx * impulse;
        target.vy = Math.max(
          target.vy,
          Math.abs(ny) * impulse * 0.5 + impulse * 0.3,
        );
        target.stagger += config.combat.staggerPerHit;
        target.staggerDecayDelay = config.combat.staggerGraceTicks;
        if (target.stagger >= config.combat.staggerThreshold) {
          target.knockdownTicks = config.combat.knockdownDurationTicks;
          target.controlLock = true;
          target.stagger = 0;
        }
      }

      // Push the ball outward if within radius.
      const ball = rw.ballPos();
      const bx = ball.x - p.x;
      const by = ball.y - p.y;
      const bd = Math.hypot(bx, by);
      if (bd <= radius) {
        const bnx = bd ? bx / bd : 1;
        const bny = bd ? by / bd : 0;
        rw.applyBallImpulse(bnx * impulse, bny * impulse);
      }
      return null;
    }

    default:
      return null;
  }
}
