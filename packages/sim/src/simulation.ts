import { type Actor, createActor, serializeActor } from "./actor";
import type { ArenaDef } from "./arena";
import type { SimConfig } from "./config";
import { hashBytes } from "./hash";
import type { InputFrame } from "./input";
import { RapierWorld } from "./rapier-world";
import { stepBall } from "./rules/ball";
import {
  type BellRingState,
  createBellRingState,
  serializeBellRingState,
  stepBellRing,
} from "./rules/bellRing";
import { resetDashOnLanding, stepDash } from "./rules/dash";
import { stepMovement } from "./rules/movement";
import { stepStrike } from "./rules/strike";

export type { InputFrame } from "./input";

export interface RenderState {
  player: {
    x: number;
    y: number;
    facing: 1 | -1;
    grounded: boolean;
    charge: number;
  };
  ball: { x: number; y: number; radius: number };
}

export type SimEvent = {
  type: "bellRing";
  bell: "left" | "right";
  tick: number;
};

// ── Debug collider shapes (world units — no Phaser pixels) ───────────────────

export interface DebugBox {
  kind: "box";
  label: string; // human-readable name for the overlay
  x: number; // centre X (world units)
  y: number; // centre Y (world units, Y-up)
  halfW: number;
  halfH: number;
}

export interface DebugCircle {
  kind: "circle";
  label: string;
  x: number;
  y: number;
  radius: number;
}

export type DebugCollider = DebugBox | DebugCircle;

// ── Opaque snapshot type for save/restore ────────────────────────────────────

export interface SimSnapshot {
  rapierBytes: Uint8Array;
  actor: Actor;
  bellRingArmed: boolean[];
  tick: number;
}

export interface Simulation {
  step(input: InputFrame): void;
  getRenderState(): RenderState;
  drainEvents(): SimEvent[];
  hashState(): string;

  /**
   * Return all physics/scoring shapes in world units so the debug overlay can
   * draw them without knowing about Rapier or pixel conversion. Includes:
   *  - arena collider boxes
   *  - player bounding box (current position)
   *  - ball circle (current position)
   *  - Bell art boxes
   *  - Bell hit-zone circles
   */
  getDebugColliders(): DebugCollider[];

  /**
   * Capture the full simulation state into an opaque snapshot that can be
   * passed back to restoreSnapshot() to rewind to this exact moment.
   * Exposed for tooling (single-step, rewind) — not part of the gameplay path.
   */
  takeSnapshot(): SimSnapshot;

  /**
   * Restore a previously taken snapshot, rewinding the sim to that state.
   * The pending event queue is cleared; tick is restored from the snapshot.
   */
  restoreSnapshot(snap: SimSnapshot): void;

  /**
   * Update one or more SimConfig fields at runtime (for HUD slider tuning).
   * Only the supplied fields are changed; the rest of the config is unchanged.
   * Note: fields that affect Rapier world construction (gravity, tickHz, body
   * sizes) cannot be mutated on a live world; only the JS-side knobs
   * (movement speeds, dash, strike parameters, ball speed clamp, etc.) are
   * live-tunable. Attempting to change physics-construction fields is silently
   * ignored in this implementation.
   */
  updateConfig(patch: Partial<SimConfig>): void;
}

export function createSimulation(opts: {
  config: SimConfig;
  arena: ArenaDef;
  seed: number;
}): Simulation {
  // Work on a mutable copy so updateConfig() can mutate freely without
  // touching the caller's original DEFAULT_CONFIG object.
  let config: SimConfig = { ...opts.config };
  const { arena } = opts;
  const rw = new RapierWorld(config, arena);
  let actor: Actor = createActor(1);
  // seed reserved for Phase 3+ seeded RNG; deterministic w/o RNG this phase.

  // Authoritative tick counter (incremented per step) and the drainable event
  // queue. The Bell Ring debounce state persists across ticks and is hashed.
  let tick = 0;
  const events: SimEvent[] = [];
  let bellRing: BellRingState = createBellRingState(arena);

  return {
    step(input) {
      // Resolve any Tele-Dash this tick (ticks cooldown, gates air-dash) and get
      // its blink displacement — applied inside movement's single sweep below.
      const blink = stepDash(actor, input, config);
      // Strike imparts impulse to the ball before the physics step integrates it.
      stepStrike(actor, input, config, rw);
      // Player movement: one collide-and-slide for walk + jump + blink, then
      // grounded reconciliation.
      stepMovement(actor, input, config, rw, blink);
      // Restore the air-dash budget once the actor is grounded again.
      resetDashOnLanding(actor);
      // Advance Rapier (ball integrates, player commits its kinematic move).
      rw.step();
      // Post-step ball maintenance: light contact push + speed clamp.
      stepBall(actor, config, rw);
      // Bell Ring detection runs after the world step, when the ball position is
      // current for this tick. Pure geometry (ball circle vs. each hit-zone),
      // debounced once per contact; queue an event per Bell that rang.
      const ball = rw.ballPos();
      const hits = stepBellRing(
        arena,
        ball.x,
        ball.y,
        config.ball.radius,
        bellRing,
      );
      for (const hit of hits) {
        events.push({ type: "bellRing", bell: hit.bell, tick });
      }
      tick += 1;
    },
    getRenderState() {
      return {
        player: {
          ...rw.playerPos(),
          facing: actor.facing,
          grounded: actor.grounded,
          charge: actor.charge,
        },
        ball: { ...rw.ballPos(), radius: config.ball.radius },
      };
    },
    drainEvents() {
      if (events.length === 0) return [];
      return events.splice(0, events.length);
    },
    // Composite hash: Rapier snapshot bytes ‖ serialized actor state ‖ serialized
    // Bell Ring debounce state. The actor struct, KinematicCharacterController,
    // and the per-Bell armed flags are NOT captured by takeSnapshot(), so all
    // halves are required to detect divergence.
    hashState() {
      return hashBytes(
        rw.takeSnapshot(),
        serializeActor(actor),
        serializeBellRingState(bellRing),
      );
    },

    getDebugColliders(): DebugCollider[] {
      const shapes: DebugCollider[] = [];

      // Arena collider boxes.
      for (let i = 0; i < arena.colliders.length; i++) {
        const c = arena.colliders[i];
        if (!c) continue;
        shapes.push({
          kind: "box",
          label: `arena[${i}]`,
          x: c.x,
          y: c.y,
          halfW: c.halfW,
          halfH: c.halfH,
        });
      }

      // Player bounding box at current world position.
      const pp = rw.playerPos();
      shapes.push({
        kind: "box",
        label: "player",
        x: pp.x,
        y: pp.y,
        halfW: config.player.halfW,
        halfH: config.player.halfH,
      });

      // Ball circle at current world position.
      const bp = rw.ballPos();
      shapes.push({
        kind: "circle",
        label: "ball",
        x: bp.x,
        y: bp.y,
        radius: config.ball.radius,
      });

      // Bell art boxes + hit-zone circles.
      for (const bell of arena.bells) {
        // Art box.
        shapes.push({
          kind: "box",
          label: `bell-${bell.id}-art`,
          x: bell.art.x,
          y: bell.art.y,
          halfW: bell.art.halfW,
          halfH: bell.art.halfH,
        });
        // Hit-zone circle (separate from art — this is what scores).
        shapes.push({
          kind: "circle",
          label: `bell-${bell.id}-hitzone`,
          x: bell.hitZone.x,
          y: bell.hitZone.y,
          radius: bell.hitZone.radius,
        });
      }

      return shapes;
    },

    takeSnapshot(): SimSnapshot {
      return {
        rapierBytes: rw.takeSnapshot(),
        // Deep-copy the actor so the snapshot is independent of future mutations.
        actor: { ...actor },
        bellRingArmed: [...bellRing.armed],
        tick,
      };
    },

    restoreSnapshot(snap: SimSnapshot): void {
      // Restore Rapier world state.
      rw.restoreSnapshot(snap.rapierBytes);
      // Restore JS-side actor.
      actor = { ...snap.actor };
      // Restore Bell Ring debounce state.
      bellRing = { armed: [...snap.bellRingArmed] };
      // Restore tick counter.
      tick = snap.tick;
      // Clear any pending events that were queued after the snapshot was taken.
      events.splice(0, events.length);
    },

    updateConfig(patch: Partial<SimConfig>): void {
      // Merge the patch into the mutable config copy. Only JS-side fields
      // (movement, dash, strike, ball speed/damping etc.) take effect immediately.
      // Physics-construction fields (gravity, tickHz, body sizes) are silently
      // ignored because they would require re-building the Rapier world.
      config = { ...config, ...patch };
    },
  };
}
