import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  initSim,
} from "./index";

beforeAll(async () => {
  await initSim();
});

function run(): string {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (let i = 0; i < 120; i++) sim.step(EMPTY_INPUT); // 4s @ 30Hz: ball falls + settles
  return sim.hashState();
}

test("falling-ball sim is deterministic across runs", () => {
  expect(run()).toBe(run());
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
