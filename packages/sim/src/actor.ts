// Sim-owned plain actor struct. This state is NOT captured by Rapier's
// takeSnapshot() (the KinematicCharacterController and these flags live JS-side),
// so it must be serialized and folded into the composite hashState().

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
}

export function createActor(facing: 1 | -1 = 1): Actor {
  return {
    vx: 0,
    vy: 0,
    grounded: false,
    facing,
    ticksSinceGrounded: 0,
    charge: 0,
    dashCooldown: 0,
    airDashAvailable: true,
  };
}

/**
 * Serialize the actor into a byte-stable buffer for hashing. Float fields are
 * written through a DataView so the bytes are identical across runs/platforms;
 * flags become single bytes. Field order is fixed (the determinism contract):
 * new fields are appended at the end so existing offsets never shift.
 */
export function serializeActor(actor: Actor): Uint8Array {
  const buf = new ArrayBuffer(8 + 8 + 1 + 1 + 4 + 8 + 4 + 1);
  const view = new DataView(buf);
  let o = 0;
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
  return new Uint8Array(buf);
}
