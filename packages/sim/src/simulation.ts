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

export interface Simulation {
  step(input: InputFrame): void;
  getRenderState(): RenderState;
  drainEvents(): SimEvent[];
  hashState(): string;
}

export function createSimulation(opts: {
  config: SimConfig;
  arena: ArenaDef;
  seed: number;
}): Simulation {
  const { config, arena } = opts;
  const rw = new RapierWorld(config, arena);
  const actor: Actor = createActor(1);
  // seed reserved for Phase 3+ seeded RNG; deterministic w/o RNG this phase.

  // Authoritative tick counter (incremented per step) and the drainable event
  // queue. The Bell Ring debounce state persists across ticks and is hashed.
  let tick = 0;
  const events: SimEvent[] = [];
  const bellRing: BellRingState = createBellRingState(arena);

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
  };
}
