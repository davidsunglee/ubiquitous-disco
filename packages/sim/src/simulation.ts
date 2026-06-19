import type { ArenaDef } from "./arena";
import type { SimConfig } from "./config";
import { hashBytes } from "./hash";
import { RapierWorld } from "./rapier-world";

export interface InputFrame {
  moveX: number;
  moveY: number;
  jumpHeld: boolean;
  dashHeld: boolean;
  strikeHeld: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  strikePressed: boolean;
  strikeReleased: boolean;
}

export const EMPTY_INPUT: InputFrame = {
  moveX: 0,
  moveY: 0,
  jumpHeld: false,
  dashHeld: false,
  strikeHeld: false,
  jumpPressed: false,
  dashPressed: false,
  strikePressed: false,
  strikeReleased: false,
};

export interface RenderState {
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
  // seed reserved for Phase 2+ seeded RNG; deterministic w/o RNG this phase.

  return {
    step(_input) {
      rw.step();
    }, // input ignored this phase
    getRenderState() {
      return { ball: { ...rw.ballPos(), radius: config.ball.radius } };
    },
    drainEvents() {
      return [];
    },
    hashState() {
      return hashBytes(rw.takeSnapshot());
    }, // Phase 2 appends actor bytes
  };
}
