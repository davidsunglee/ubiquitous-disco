import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

/**
 * Scripted session: move right, a held (full-height) Jump, settle, a tapped
 * (short) Jump, then move left into the wall. Edges (jumpPressed/jumpHeld) are
 * authored so the variable-jump path is exercised.
 */
function scriptedFrames(): InputFrame[] {
  const frames: InputFrame[] = [];
  // walk right for 15 ticks
  for (let i = 0; i < 15; i++) frames.push(frame({ moveX: 1 }));
  // full-height jump: press on tick 0, then keep holding while moving right
  frames.push(frame({ moveX: 1, jumpPressed: true, jumpHeld: true }));
  for (let i = 0; i < 25; i++) frames.push(frame({ moveX: 1, jumpHeld: true }));
  // settle back on the ground
  for (let i = 0; i < 20; i++) frames.push(frame({}));
  // tapped jump: press for a single tick, release immediately (cut velocity)
  frames.push(frame({ jumpPressed: true, jumpHeld: true }));
  for (let i = 0; i < 25; i++) frames.push(frame({}));
  // run left into the left wall
  for (let i = 0; i < 40; i++) frames.push(frame({ moveX: -1 }));
  return frames;
}

function run(frames: InputFrame[]): string {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (const f of frames) sim.step(f);
  return sim.hashState();
}

test("falling-ball sim is deterministic across runs", () => {
  const frames = Array.from({ length: 120 }, () => EMPTY_INPUT);
  expect(run(frames)).toBe(run(frames));
});

test("scripted move/jump session produces an equal composite hash across runs", () => {
  const frames = scriptedFrames();
  expect(run(frames)).toBe(run(frames));
});

test("ball falls from spawn under gravity", () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1,
  });
  const startY = sim.getRenderState().ball.y;
  for (let i = 0; i < 30; i++) sim.step(EMPTY_INPUT);
  expect(sim.getRenderState().ball.y).toBeLessThan(startY);
});

test("player moves right and stops at the right wall", () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1,
  });
  const startX = sim.getRenderState().player.x;
  for (let i = 0; i < 120; i++) sim.step(frame({ moveX: 1 }));
  const endX = sim.getRenderState().player.x;
  expect(endX).toBeGreaterThan(startX);
  // right wall inner face is at x = 11.5; player halfW 0.4 → cannot pass ~11.1
  expect(endX).toBeLessThan(11.2);
  expect(sim.getRenderState().player.facing).toBe(1);
});

test("held jump rises higher than a tapped jump", () => {
  const peak = (jumpFrames: InputFrame[]): number => {
    const sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 1,
    });
    // let the player settle on the floor first
    for (let i = 0; i < 10; i++) sim.step(EMPTY_INPUT);
    let maxY = sim.getRenderState().player.y;
    for (const f of jumpFrames) {
      sim.step(f);
      maxY = Math.max(maxY, sim.getRenderState().player.y);
    }
    return maxY;
  };

  const held: InputFrame[] = [
    frame({ jumpPressed: true, jumpHeld: true }),
    ...Array.from({ length: 30 }, () => frame({ jumpHeld: true })),
  ];
  const tapped: InputFrame[] = [
    frame({ jumpPressed: true, jumpHeld: true }),
    ...Array.from({ length: 30 }, () => EMPTY_INPUT),
  ];

  expect(peak(held)).toBeGreaterThan(peak(tapped));
});
