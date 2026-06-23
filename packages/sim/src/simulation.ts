import { type Actor, controllable, createActor, serializeActor } from "./actor";
import type { ArenaDef } from "./arena";
import { CHARACTERS, type CharacterDef, resolveCharacter } from "./character";
import type { SimConfig } from "./config";
import { hashBytes } from "./hash";
import type { InputFrame } from "./input";
import { RapierWorld } from "./rapier-world";
import { nextRng, seedRng } from "./rng";
import { stepBall } from "./rules/ball";
import {
  advancePressureRamp,
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
import { type SpecialBlink, stepSpecial } from "./rules/special";
import { stepStrike } from "./rules/strike";
import { teamForPlayerSlot } from "./team";

export type { InputFrame } from "./input";
export type { MatchPhase, MatchState } from "./rules/match";

// ── Authoritative state for networked play (Phase 2) ─────────────────────────

/**
 * Per-player authoritative state. Includes both the Rapier-side position (which
 * the client reconstructs via rapierBytes restore or lightweight setPlayerPosition)
 * and the JS-side actor fields that Rapier does not capture.
 */
export interface AuthPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  charge: number;
  knockdownTicks: number;
  invulnTicks: number;
}

/**
 * Full authoritative world state at a given server tick.
 * The server builds this via `toAuthoritativeState(sim)` and broadcasts it.
 * The client applies it via `sim.applyAuthoritativeState(s)`.
 *
 * rapierBytes: the raw Rapier world snapshot (from rw.takeSnapshot()) used to
 * faithfully restore the dynamic ball and all contact-solver state.
 */
export interface AuthoritativeState {
  tick: number;
  players: AuthPlayer[];
  ball: { x: number; y: number; vx: number; vy: number };
  rapierBytes: Uint8Array;
  match: MatchState;
}

export interface RenderState {
  players: {
    x: number;
    y: number;
    facing: 1 | -1;
    grounded: boolean;
    charge: number;
    knockedDown: boolean; // knockdownTicks > 0
    invulnerable: boolean; // invulnTicks > 0
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
    }
  | {
      type: "knockdown";
      slot: number;
      tick: number;
    }
  | {
      // Emitted whenever a strike connects with a player (every connecting hit,
      // not just knockdowns) so the renderer can give clear per-hit feedback.
      type: "playerHit";
      slot: number; // the target slot that got hit
      knockdown: boolean; // true if this hit caused a knockdown
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
  /** Phase-6 (FLI-9): full bell ring state snapshot (includes radiusBonus + rampTicks). */
  bellRingState?: { radiusBonus: number; rampTicks: number };
  tick: number;
  match: MatchState;
  /** Phase-3 (FLI-9): seeded PRNG state for in-process rewind determinism. */
  rngState: number;
}

export interface Simulation {
  step(inputs: InputFrame[]): void;
  getRenderState(): RenderState;
  drainEvents(): SimEvent[];
  hashState(): string;

  /** Return the current match state (scores, phase, timer, etc.) for HUD display. */
  getMatchState(): MatchState;

  /**
   * Return the ball's current linear velocity (world units/s).
   * Used by the server to build `WorldSnapshot.ball.vx/vy` and by Phase-0
   * fidelity tests to capture lightweight authoritative state.
   */
  getBallVel(): { vx: number; vy: number };

  /**
   * Apply lightweight authoritative state: write player positions and ball
   * position+velocity directly into the live Rapier world without a full
   * rapierBytes snapshot restore. Used as the Phase-0 candidate path in
   * fidelity testing; superseded by `applyAuthoritativeState` in Phase 2.
   *
   * Does NOT restore actor JS fields (charge, knockdown, etc.) — those
   * require the full AuthoritativeState that Phase 2 introduces.
   */
  applyLightweightPositions(state: {
    players: { x: number; y: number }[];
    ball: { x: number; y: number; vx: number; vy: number };
  }): void;

  /**
   * Teleport the non-owned (remote) player slot to the given interpolated
   * position so that local ball↔remote collisions during prediction/replay
   * use a realistic remote position (Q4 / Phase 3).
   *
   * Only updates the Rapier body position and (optionally) the actor facing
   * field — all other actor JS state is left unchanged. This is the hook
   * called each predicted/replayed tick to feed the interpolation buffer
   * position into the live sim without stepping the remote player's input.
   */
  setSlotKinematicPosition(
    slot: number,
    x: number,
    y: number,
    facing?: 1 | -1,
  ): void;

  /**
   * Apply a full authoritative state from the server.
   *
   * Ball path (Phase-0 Decision 0b): calls rw.restoreSnapshot(s.rapierBytes)
   * to restore the full Rapier world including dynamic ball + contact-solver
   * warm-start state. Kinematic player positions are then overwritten from
   * s.players[i].{x,y} (lightweight, faithful for kinematic bodies).
   *
   * Actor JS fields (vx, vy, facing, grounded, charge, knockdownTicks,
   * invulnTicks) are written from s.players[i] fields.
   *
   * Match state and tick counter are replaced from s.match / s.tick.
   * The pending event queue is cleared (mirrors restoreSnapshot).
   */
  applyAuthoritativeState(s: AuthoritativeState): void;

  /**
   * Return the current effective hit-zone radius for each Bell (in arena order).
   * During Golden Goal the base radius grows by radiusBonus; outside Golden Goal
   * this equals the arena's static radius. Used by the renderer to draw the live
   * grown hit-zone without coupling the render layer to bellRing internals.
   */
  getBellHitRadii(): number[];

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

/**
 * Extract a full `AuthoritativeState` from a running simulation.
 * Called by the server each time it broadcasts a WorldSnapshot.
 *
 * The rapierBytes field is taken via the Simulation's takeSnapshot() — the
 * server accesses this through the public interface. However, to avoid exposing
 * the full SimSnapshot internals in the network state, we take a fresh Rapier
 * snapshot separately. Since Simulation exposes `takeSnapshot()` which includes
 * rapierBytes, the server uses that path.
 *
 * NOTE: This function is a pure data extraction helper. It calls
 * `sim.takeSnapshot()` for the Rapier bytes and `sim.getRenderState()` +
 * `sim.getBallVel()` + `sim.getMatchState()` for the JS-side state.
 */
export function toAuthoritativeState(sim: Simulation): AuthoritativeState {
  const snap = sim.takeSnapshot();
  const render = sim.getRenderState();
  const ballVel = sim.getBallVel();
  const match = sim.getMatchState();

  return {
    tick: snap.tick,
    players: render.players.map((p, i) => {
      const actor = snap.actors[i];
      return {
        x: p.x,
        y: p.y,
        vx: actor?.vx ?? 0,
        vy: actor?.vy ?? 0,
        facing: p.facing,
        grounded: p.grounded,
        charge: p.charge,
        knockdownTicks: actor?.knockdownTicks ?? 0,
        invulnTicks: actor?.invulnTicks ?? 0,
      };
    }),
    ball: { x: render.ball.x, y: render.ball.y, ...ballVel },
    rapierBytes: snap.rapierBytes,
    match,
  };
}

export function createSimulation(opts: {
  config: SimConfig;
  arena: ArenaDef;
  seed: number;
  /** Active Player Slots (mode template). Default 1v1 = [0, 2]. */
  activeSlots?: number[];
  /** Per-slot character defs (indexed by slot). Default = Sifu for every active slot. */
  characters?: CharacterDef[];
}): Simulation {
  // Work on a mutable copy so updateConfig() can mutate freely without
  // touching the caller's original DEFAULT_CONFIG object.
  let config: SimConfig = { ...opts.config };
  const { arena } = opts;
  const activeSlots = (opts.activeSlots ?? [0, 2])
    .slice()
    .sort((a, b) => a - b);
  // Per-slot character DEFS retained so updateConfig() can re-resolve multipliers.
  const characterDefs: CharacterDef[] = [];
  for (const s of activeSlots) {
    characterDefs[s] = opts.characters?.[s] ?? CHARACTERS.sifu;
  }
  let resolved: import("./character").ResolvedCharacter[] = [];
  const resolveAll = () => {
    resolved = [];
    for (const s of activeSlots) {
      const def = characterDefs[s] ?? CHARACTERS.sifu;
      resolved[s] = resolveCharacter(def, config);
    }
  };
  resolveAll();
  const rw = new RapierWorld(config, arena, activeSlots);
  // Sparse actors keyed by slot id. Team 0 (slots 0/1) faces right (+1);
  // Team 1 (slots 2/3) faces left (-1) toward the centre.
  let actors: Actor[] = [];
  for (const s of activeSlots) {
    actors[s] = createActor(
      teamForPlayerSlot(s as 0 | 1 | 2 | 3) === 0 ? 1 : -1,
      resolved[s],
    );
  }
  // Phase-3 (FLI-9): sim-wide PRNG state, seeded from opts.seed.
  // Serialized + hashed + restored so rewind/replay stay deterministic.
  let rngState = seedRng(opts.seed);

  // Authoritative tick counter (incremented per step) and the drainable event
  // queue. The Bell Ring debounce state persists across ticks and is hashed.
  let tick = 0;
  const events: SimEvent[] = [];
  let bellRing: BellRingState = createBellRingState(arena);

  // Official modes always have exactly two Teams; scores are Team-indexed and
  // decoupled from the number of occupied Player Slots.
  let match: MatchState = createMatchState(config, 2);

  return {
    step(inputs: InputFrame[]) {
      if (isLivePhase(match) && match.pauseTicks === 0) {
        // ── Gameplay rules run ONLY in live phases ──
        const blinks: (DashBlink | null)[] = [];

        // Snapshot start-of-tick state for each slot before any strikes resolve.
        // This ensures:
        //  (a) A slot that was already knocked down before this tick cannot
        //      initiate a strike (wasControllable[s] = false).
        //  (b) A slot that BECOMES knocked down by an earlier slot's strike this
        //      tick can still resolve its own strike (mutual trades land for both).
        //  (c) The knockdown event is emitted only for slots that were NOT already
        //      knocked down at tick start (wasDown).
        const wasDown = actors.map((a) => a.knockdownTicks > 0);
        // Capture start-of-tick controllable state for each slot so that:
        //  (a) Already-knocked-down actors cannot initiate strikes this tick.
        //  (b) An actor knocked DOWN by an earlier slot's strike this tick can
        //      still resolve its own strike (mutual trades land for both).
        const wasControllable = actors.map((a) => controllable(a));
        // Start-of-tick stagger per slot, so we can detect non-knockdown hits
        // (stagger is reset to 0 by the hit that causes a knockdown).
        const staggerBefore = actors.map((a) => a.stagger);

        for (let s = 0; s < actors.length; s++) {
          const actor = actors[s];
          const input = inputs[s];
          if (!actor || !input) continue;
          blinks[s] = stepDash(actor, input, config);
          // Only initiate a strike/special if the actor was controllable at tick START.
          if (wasControllable[s]) {
            stepStrike(actor, input, config, rw, s, actors);
            const sb: SpecialBlink | null = stepSpecial(
              actor,
              input,
              config,
              rw,
              s,
              actors,
              () => {
                const r = nextRng(rngState);
                rngState = r.state;
                return r.value;
              },
            );
            // Combine blink-style Special displacement with any dash blink.
            // (Same-tick dash+special is rare but we sum the displacements so the
            // movement sweep clamps both against geometry in one authoritative move.)
            if (sb) {
              const existing = blinks[s];
              blinks[s] = existing
                ? { x: existing.x + sb.x, y: existing.y + sb.y }
                : sb;
            }
          } else {
            // Clear charge so it doesn't linger while knocked down.
            actor.charge = 0;
          }
        }

        // Emit per-hit + knockdown events for any target struck this tick.
        for (let t = 0; t < actors.length; t++) {
          const a = actors[t];
          if (!a) continue;
          const newlyDown = !wasDown[t] && a.knockdownTicks > 0;
          // A hit landed if stagger went up, or if this hit caused a knockdown
          // (which resets stagger to 0, hiding it from the stagger comparison).
          const struck = newlyDown || a.stagger > (staggerBefore[t] ?? 0);
          if (struck) {
            events.push({
              type: "playerHit",
              slot: t,
              knockdown: newlyDown,
              tick,
            });
          }
          if (newlyDown) {
            events.push({ type: "knockdown", slot: t, tick });
          }
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

        // ── Combat timers advance each live tick (anti-stunlock) ──
        for (let s = 0; s < actors.length; s++) {
          const a = actors[s];
          if (!a) continue;
          // Stagger holds during the post-hit grace window, then bleeds off so
          // a paused exchange doesn't keep stale stagger (anti-chip).
          if (a.staggerDecayDelay > 0) {
            a.staggerDecayDelay -= 1;
          } else if (a.stagger > 0) {
            a.stagger = Math.max(
              0,
              a.stagger - config.combat.staggerDecayPerTick,
            );
          }
          // Knockdown countdown; stand-up edge grants i-frames and returns control.
          if (a.knockdownTicks > 0) {
            a.knockdownTicks -= 1;
            if (a.knockdownTicks === 0) {
              a.controlLock = false;
              a.invulnTicks = config.combat.recoveryInvulnTicks;
            }
          } else if (a.invulnTicks > 0) {
            a.invulnTicks -= 1;
          }
        }
        // Bell Ring detection runs after the world step, when the ball position is
        // current for this tick.
        // Phase-6 (FLI-9): advance the overtime pressure ramp during Golden Goal.
        if (match.phase === "goldenGoal") advancePressureRamp(bellRing, config);
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
        actors = [];
        for (const s of activeSlots) {
          // Re-create the actor to clear all velocity/charge state on respawn.
          actors[s] = createActor(
            teamForPlayerSlot(s as 0 | 1 | 2 | 3) === 0 ? 1 : -1,
            resolved[s],
          );
        }
        // Re-arm bells after respawn so the next contact can ring.
        bellRing = createBellRingState(arena);
        // Phase-3 (FLI-9): re-seed the PRNG on round reset so each round
        // starts from the same deterministic base (seed-independent across rounds).
        rngState = seedRng(opts.seed);
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
          knockedDown: a.knockdownTicks > 0,
          invulnerable: a.invulnTicks > 0,
        })),
        ball: { ...rw.ballPos(), radius: config.ball.radius },
      };
    },
    drainEvents() {
      if (events.length === 0) return [];
      return events.splice(0, events.length);
    },
    // Composite hash: Rapier snapshot bytes ‖ serialized actors in activeSlots order
    // ‖ serialized Bell Ring debounce state ‖ serialized match state ‖ rngState (Phase 3).
    // Fixed concatenation order — any change in field count or type shape must be reflected
    // here. Note: iterate activeSlots (not the sparse actors[] array) to avoid undefined
    // holes in the spread when slots are non-contiguous (e.g. 1v1 template [0, 2]).
    hashState() {
      // Serialize rngState as a 4-byte Uint32 (big-endian).
      const rngBuf = new ArrayBuffer(4);
      new DataView(rngBuf).setUint32(0, rngState >>> 0);
      return hashBytes(
        rw.takeSnapshot(),
        // biome-ignore lint/style/noNonNullAssertion: actors[s] is always defined for s in activeSlots
        ...activeSlots.map((s) => serializeActor(actors[s]!)),
        serializeBellRingState(bellRing),
        serializeMatchState(match),
        new Uint8Array(rngBuf), // Phase-3: sim-wide PRNG state appended last
      );
    },

    getMatchState(): MatchState {
      // Return a shallow copy with a cloned scores array to prevent external mutation.
      return { ...match, scores: [...match.scores] };
    },

    getBellHitRadii(): number[] {
      return arena.bells.map((b) => b.hitZone.radius + bellRing.radiusBonus);
    },

    getBallVel(): { vx: number; vy: number } {
      const v = rw.ballVel();
      return { vx: v.x, vy: v.y };
    },

    applyLightweightPositions(state: {
      players: { x: number; y: number }[];
      ball: { x: number; y: number; vx: number; vy: number };
    }): void {
      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (!p) continue;
        rw.setPlayerPosition(i, p.x, p.y);
      }
      rw.setBallPosition(state.ball.x, state.ball.y);
      rw.setBallVel(state.ball.vx, state.ball.vy);
    },

    setSlotKinematicPosition(
      slot: number,
      x: number,
      y: number,
      facing?: 1 | -1,
    ): void {
      rw.setPlayerPosition(slot, x, y);
      const a = actors[slot];
      if (a && facing !== undefined) {
        a.facing = facing;
      }
    },

    applyAuthoritativeState(s: AuthoritativeState): void {
      // 1. Restore full Rapier world (dynamic ball + contact-solver state).
      //    Phase-0 Decision 0b: rapierBytes is required for ball fidelity.
      rw.restoreSnapshot(s.rapierBytes);

      // 2. Overwrite actor JS fields + kinematic player positions.
      //    setPlayerPosition is needed because restoreSnapshot restores the
      //    kinematic body transforms but we want explicit server-authoritative
      //    positions (also handles the case where rapierBytes was from a
      //    slightly different tick than the player JS fields).
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        const p = s.players[i];
        if (!a || !p) continue;
        a.vx = p.vx;
        a.vy = p.vy;
        a.facing = p.facing;
        a.grounded = p.grounded;
        a.charge = p.charge;
        a.knockdownTicks = p.knockdownTicks;
        a.invulnTicks = p.invulnTicks;
        // Sync kinematic player position (restoreSnapshot already did this via
        // the Rapier snapshot, but write explicitly for clarity and safety).
        rw.setPlayerPosition(i, p.x, p.y);
      }

      // 3. Replace match state and tick counter.
      match = { ...s.match, scores: [...s.match.scores] };
      tick = s.tick;

      // 4. Clear any pending events (matches restoreSnapshot behavior).
      events.splice(0, events.length);
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

      // Player bounding boxes at current world positions (active slots only).
      for (const s of activeSlots) {
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
        // Phase-6 (FLI-9): capture full bell ring state for accurate rewind.
        bellRingState: {
          radiusBonus: bellRing.radiusBonus,
          rampTicks: bellRing.rampTicks,
        },
        tick,
        // Deep-copy match state (scores array must be copied too).
        match: { ...match, scores: [...match.scores] },
        // Phase-3 (FLI-9): capture current PRNG state for rewind determinism.
        rngState,
      };
    },

    restoreSnapshot(snap: SimSnapshot): void {
      // Restore Rapier world state.
      rw.restoreSnapshot(snap.rapierBytes);
      // Restore JS-side actors.
      actors = snap.actors.map((a) => ({ ...a }));
      // Restore Bell Ring debounce state (including Phase-6 overtime ramp fields).
      bellRing = {
        armed: [...snap.bellRingArmed],
        radiusBonus: snap.bellRingState?.radiusBonus ?? 0,
        rampTicks: snap.bellRingState?.rampTicks ?? 0,
      };
      // Restore tick counter.
      tick = snap.tick;
      // Restore match state.
      match = { ...snap.match, scores: [...snap.match.scores] };
      // Phase-3 (FLI-9): restore PRNG state so rewind stays deterministic.
      rngState = snap.rngState;
      // Clear any pending events that were queued after the snapshot was taken.
      events.splice(0, events.length);
    },

    updateConfig(patch: Partial<SimConfig>): void {
      // Merge the patch into the mutable config copy. Only JS-side fields
      // (movement, dash, strike, ball speed/damping etc.) take effect immediately.
      // Physics-construction fields (gravity, tickHz, body sizes) are silently
      // ignored because they would require re-building the Rapier world.
      config = { ...config, ...patch };
      // Re-resolve per-actor stats so HUD sliders still scale the baseline
      // (multipliers stay constant). Reassign the live actors' character references.
      resolveAll();
      for (const s of activeSlots) {
        const a = actors[s];
        const r = resolved[s];
        if (a && r) a.character = r;
      }
    },
  };
}
