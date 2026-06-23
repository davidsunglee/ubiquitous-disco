// Sim-owned plain actor struct. This state is NOT captured by Rapier's
// takeSnapshot() (the KinematicCharacterController and these flags live JS-side),
// so it must be serialized and folded into the composite hashState().

import {
  DEFAULT_RESOLVED_CHARACTER,
  type ResolvedCharacter,
} from "./character";

export interface Actor {
  // Authoritative velocity in world units / second (X right, Y up).
  vx: number;
  vy: number;
  grounded: boolean;
  facing: 1 | -1;
  // Ticks since the actor last left the ground; used for coyote-time Jump grace.
  ticksSinceGrounded: number;
  // Strike charge accumulator (ticks, clamped to the configured max while held).
  charge: number;
  // Ticks remaining before another Tele-Dash is allowed (0 = ready).
  dashCooldown: number;
  // Whether the one-per-airtime air Dash is still available. Reset on landing.
  airDashAvailable: boolean;
  // ── Combat (Phase 3) — appended after existing fields ──
  // Stagger accumulator; decays each live tick. Crossing staggerThreshold → Knockdown.
  stagger: number;
  // Control-locked while > 0 (counts down each live tick).
  knockdownTicks: number;
  // Recovery Invulnerability ticks granted on stand-up (full i-frames while > 0).
  invulnTicks: number;
  // True while knocked down (ignores input).
  controlLock: boolean;
  // Grace window (ticks) during which stagger does NOT decay. Refreshed on every
  // hit so a normal exchange reliably stacks to the Knockdown threshold; once it
  // expires (no contact), stagger bleeds off again (anti-chip).
  staggerDecayDelay: number;
  /** Phase 2 (FLI-9): ticks remaining before another Special is allowed (0 = ready). */
  specialCooldown: number;
  /** Phase 4 (FLI-9): remaining mid-air jumps (initialized from character.airJumps; reset on landing). */
  airJumpsRemaining: number;
  /**
   * Phase 7 (FLI-9): slot of the actor who most recently struck this target this
   * tick (-1 = none). Used ONLY for event attribution (e.g. friendly-fire
   * knockdowns) — transient, NOT serialized and NOT folded into hashState().
   */
  lastHitBy: number;
  /** Resolved per-actor character (stats/special/airJumps). Static config — NOT hashed. */
  character: ResolvedCharacter;
}

export function createActor(
  facing: 1 | -1 = 1,
  character: ResolvedCharacter = DEFAULT_RESOLVED_CHARACTER,
): Actor {
  return {
    vx: 0,
    vy: 0,
    grounded: false,
    facing,
    ticksSinceGrounded: 0,
    charge: 0,
    dashCooldown: 0,
    airDashAvailable: true,
    stagger: 0,
    knockdownTicks: 0,
    invulnTicks: 0,
    controlLock: false,
    staggerDecayDelay: 0,
    specialCooldown: 0,
    airJumpsRemaining: character.airJumps,
    lastHitBy: -1,
    character,
  };
}

/**
 * Returns true when the actor can accept input (not knocked down).
 * A knocked-down actor still integrates physics (gravity, knockback velocity)
 * but ignores move/jump/dash/strike intent.
 */
export function controllable(actor: Actor): boolean {
  return actor.knockdownTicks <= 0 && !actor.controlLock;
}

/**
 * Serialize the actor into a byte-stable buffer for hashing. Float fields are
 * written through a DataView so the bytes are identical across runs/platforms;
 * flags become single bytes. Field order is fixed (the determinism contract):
 * new fields are appended at the end so existing offsets never shift.
 */
export function serializeActor(actor: Actor): Uint8Array {
  // Existing 35 bytes (8 writes, order frozen as the determinism contract):
  //   vx f64 (8) + vy f64 (8) + grounded u8 (1) + facing i8 (1) +
  //   ticksSinceGrounded i32 (4) + charge f64 (8) + dashCooldown i32 (4) +
  //   airDashAvailable u8 (1) = 35
  // Phase 3 appends 21 bytes:
  //   stagger f64 (8) + knockdownTicks i32 (4) + invulnTicks i32 (4) +
  //   controlLock u8 (1) + staggerDecayDelay i32 (4) = 21
  // Phase 2 (FLI-9) appends 4 bytes:
  //   specialCooldown i32 (4) = 4
  // Phase 4 (FLI-9) appends 4 bytes:
  //   airJumpsRemaining i32 (4) = 4
  // Total: 64 bytes.
  // NOTE: Phase 7's lastHitBy is intentionally NOT serialized — it is transient
  // event-attribution metadata, excluded from hashState() (so the golden hash is
  // unchanged).
  const buf = new ArrayBuffer(
    8 + 8 + 1 + 1 + 4 + 8 + 4 + 1 + 8 + 4 + 4 + 1 + 4 + 4 + 4,
  );
  const view = new DataView(buf);
  let o = 0;
  // ── Existing 8 writes — byte-identical to the pre-Phase-3 layout ──
  view.setFloat64(o, actor.vx);
  o += 8;
  view.setFloat64(o, actor.vy);
  o += 8;
  view.setUint8(o, actor.grounded ? 1 : 0);
  o += 1;
  view.setInt8(o, actor.facing);
  o += 1;
  view.setInt32(o, actor.ticksSinceGrounded);
  o += 4;
  view.setFloat64(o, actor.charge);
  o += 8;
  view.setInt32(o, actor.dashCooldown);
  o += 4;
  view.setUint8(o, actor.airDashAvailable ? 1 : 0);
  o += 1; // advance past the last existing field (o = 35)
  // ── Phase 3 appended fields (o starts at 35) ──
  view.setFloat64(o, actor.stagger);
  o += 8;
  view.setInt32(o, actor.knockdownTicks);
  o += 4;
  view.setInt32(o, actor.invulnTicks);
  o += 4;
  view.setUint8(o, actor.controlLock ? 1 : 0);
  o += 1;
  view.setInt32(o, actor.staggerDecayDelay);
  o += 4;
  // ── Phase 2 (FLI-9) appended field ──
  view.setInt32(o, actor.specialCooldown);
  o += 4;
  // ── Phase 4 (FLI-9) appended field ──
  view.setInt32(o, actor.airJumpsRemaining);
  return new Uint8Array(buf);
}
