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
import type { DashBlink } from "./rules/dash";
import { resetDashOnLanding, stepDash } from "./rules/dash";
import {
  createMatchState,
  isLivePhase,
  type MatchState,
  serializeMatchState,
  stepMatch,
} from "./rules/match";
import { stepMovement } from "./rules/movement";
import { stepStrike } from "./rules/strike";

export type { InputFrame } from "./input";
export type { MatchPhase, MatchState } from "./rules/match";

export interface RenderState {
  players: {
    x: number;
    y: number;
    facing: 1 | -1;
    grounded: boolean;
    charge: number;
  }[];
  ball: { x: number; y: number; radius: number };
}

export type SimEvent =
  | {
      type: "bellRing";
      bell: "left" | "right";
      scoringTeam: number;
      tick: number;
    }
  | {
      type: "matchPhase";
      phase: import("./rules/match").MatchPhase;
      tick: number;
    }
  | {
      type: "matchEnd";
      winner: number | "tie";
      scores: number[];
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
  actors: Actor[];
  bellRingArmed: boolean[];
  tick: number;
  match: MatchState;
}

export interface Simulation {
  step(inputs: InputFrame[]): void;
  getRenderState(): RenderState;
  drainEvents(): SimEvent[];
  hashState(): string;

  /** Return the current match state (scores, phase, timer, etc.) for HUD display. */
  getMatchState(): MatchState;

  /**
   * Return all physics/scoring shapes in world units so the debug overlay can
   * draw them without knowing about Rapier or pixel conversion. Includes:
   *  - arena collider boxes
   *  - player bounding boxes (current position, one per slot)
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
  // Slot 0 faces right (+1), slot 1 faces left (-1) toward the centre.
  let actors: Actor[] = arena.playerSpawns.map((_, s) =>
    createActor(s === 0 ? 1 : -1),
  );
  // seed reserved for Phase 3+ seeded RNG; deterministic w/o RNG this phase.

  // Authoritative tick counter (incremented per step) and the drainable event
  // queue. The Bell Ring debounce state persists across ticks and is hashed.
  let tick = 0;
  const events: SimEvent[] = [];
  let bellRing: BellRingState = createBellRingState(arena);

  // Match state: owns phase, scores, timer, pause/reset counters.
  let match: MatchState = createMatchState(config, actors.length);

  return {
    step(inputs: InputFrame[]) {
      if (isLivePhase(match) && match.pauseTicks === 0) {
        // ── Gameplay rules run ONLY in live phases ──
        const blinks: (DashBlink | null)[] = [];
        for (let s = 0; s < actors.length; s++) {
          const actor = actors[s];
          const input = inputs[s];
          if (!actor || !input) continue;
          blinks[s] = stepDash(actor, input, config);
          stepStrike(actor, input, config, rw, s);
        }
        for (let s = 0; s < actors.length; s++) {
          const actor = actors[s];
          const input = inputs[s];
          if (!actor || !input) continue;
          stepMovement(actor, input, config, rw, s, blinks[s] ?? null);
          resetDashOnLanding(actor);
        }
        // One physics step commits both kinematic moves + integrates the ball.
        rw.step();
        // Post-physics per-slot ball maintenance, then one bell-ring pass.
        for (let s = 0; s < actors.length; s++) {
          const actor = actors[s];
          if (!actor) continue;
          stepBall(actor, config, rw, s);
        }
        // Bell Ring detection runs after the world step, when the ball position is
        // current for this tick.
        const ball = rw.ballPos();
        const hits = stepBellRing(
          arena,
          ball.x,
          ball.y,
          config.ball.radius,
          bellRing,
        );
        for (const hit of hits) {
          // Map bell → defending team → OPPOSING scorer (own-goals fall out naturally).
          const bellDef = arena.bells.find((b) => b.id === hit.bell);
          const defendingTeam = bellDef?.defends === "left" ? 0 : 1;
          const scoringTeam = defendingTeam === 0 ? 1 : 0;
          match.scores[scoringTeam] = (match.scores[scoringTeam] ?? 0) + 1;
          events.push({ type: "bellRing", bell: hit.bell, scoringTeam, tick });
          // Golden Goal: a ring ends the match immediately (finish set by sim, not stepMatch).
          if (match.phase === "goldenGoal") {
            const top = Math.max(...match.scores);
            const leaders = match.scores.filter((s) => s === top).length;
            match.winner = leaders > 1 ? -1 : match.scores.indexOf(top);
            match.phase = "complete";
            events.push({ type: "matchPhase", phase: "complete", tick });
            events.push({
              type: "matchEnd",
              winner: match.winner === -1 ? "tie" : match.winner,
              scores: [...match.scores],
              tick,
            });
          } else {
            // Normal scoring: enter bellPause, then resetting.
            match.pauseTicks = config.match.scoringPauseTicks;
            match.phase = "bellPause";
            events.push({ type: "matchPhase", phase: "bellPause", tick });
          }
        }
      } else if (
        match.phase === "resetting" &&
        match.resetTicks === config.match.resetTicks
      ) {
        // First tick of resetting: teleport everyone home, then freeze for the countdown.
        rw.resetPositions(arena);
        for (let s = 0; s < actors.length; s++) {
          // Re-create the actor to clear all velocity/charge state on respawn.
          actors[s] = createActor(s === 0 ? 1 : -1);
        }
        // Re-arm bells after respawn so the next contact can ring.
        bellRing = createBellRingState(arena);
      }

      // Match lifecycle advances EVERY tick (even frozen ones); tick always increments.
      stepMatch(
        match,
        inputs,
        { push: (e) => events.push(e as SimEvent) },
        config,
        tick,
      );
      tick += 1;
    },
    getRenderState() {
      return {
        players: actors.map((a, s) => ({
          ...rw.playerPos(s),
          facing: a.facing,
          grounded: a.grounded,
          charge: a.charge,
        })),
        ball: { ...rw.ballPos(), radius: config.ball.radius },
      };
    },
    drainEvents() {
      if (events.length === 0) return [];
      return events.splice(0, events.length);
    },
    // Composite hash: Rapier snapshot bytes ‖ serialized actor[0] ‖ serialized actor[1]
    // ‖ serialized Bell Ring debounce state ‖ serialized match state. Fixed concatenation
    // order — any change in field count or type shape must be reflected here.
    hashState() {
      return hashBytes(
        rw.takeSnapshot(),
        ...actors.map((a) => serializeActor(a)),
        serializeBellRingState(bellRing),
        serializeMatchState(match),
      );
    },

    getMatchState(): MatchState {
      // Return a shallow copy with a cloned scores array to prevent external mutation.
      return { ...match, scores: [...match.scores] };
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

      // Player bounding boxes at current world positions (one per slot).
      for (let s = 0; s < actors.length; s++) {
        const pp = rw.playerPos(s);
        shapes.push({
          kind: "box",
          label: `player[${s}]`,
          x: pp.x,
          y: pp.y,
          halfW: config.player.halfW,
          halfH: config.player.halfH,
        });
      }

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
        // Deep-copy each actor so the snapshot is independent of future mutations.
        actors: actors.map((a) => ({ ...a })),
        bellRingArmed: [...bellRing.armed],
        tick,
        // Deep-copy match state (scores array must be copied too).
        match: { ...match, scores: [...match.scores] },
      };
    },

    restoreSnapshot(snap: SimSnapshot): void {
      // Restore Rapier world state.
      rw.restoreSnapshot(snap.rapierBytes);
      // Restore JS-side actors.
      actors = snap.actors.map((a) => ({ ...a }));
      // Restore Bell Ring debounce state.
      bellRing = { armed: [...snap.bellRingArmed] };
      // Restore tick counter.
      tick = snap.tick;
      // Restore match state.
      match = { ...snap.match, scores: [...snap.match.scores] };
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
