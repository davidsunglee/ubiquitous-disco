import { type Actor, createActor, serializeActor } from "./actor";
import type { ArenaDef } from "./arena";
import type { SimConfig } from "./config";
import { hashBytes } from "./hash";
import type { InputFrame } from "./input";
import { RapierWorld } from "./rapier-world";
import { stepMovement } from "./rules/movement";

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
  const { config } = opts;
  const rw = new RapierWorld(config, opts.arena);
  const actor: Actor = createActor(1);
  // seed reserved for Phase 3+ seeded RNG; deterministic w/o RNG this phase.

  return {
    step(input) {
      stepMovement(actor, input, config, rw);
      rw.step();
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
      return [];
    },
    // Composite hash: Rapier snapshot bytes ‖ serialized actor state. The actor
    // struct and KinematicCharacterController are NOT captured by takeSnapshot(),
    // so both halves are required to detect divergence.
    hashState() {
      return hashBytes(rw.takeSnapshot(), serializeActor(actor));
    },
  };
}
