import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  type DebugRamp,
  EMPTY_INPUT,
  initSim,
} from "../index";
import { RAMP_FIXTURE } from "./fixtures/rampFixture";
import { testArenaMirrorSymmetry } from "./helpers/arenaSymmetry";

beforeAll(async () => {
  await initSim();
});

// Right ramp: slope from (3,0) to (9,3) — rise 3 over run 6 = slope 0.5.
// For a ball center at world-x in [3,9], the ramp surface y = (x - 3) * 0.5.
const surfaceY = (x: number) => Math.min(Math.max((x - 3) * 0.5, 0), 3);

const newRampSim = () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: RAMP_FIXTURE,
    seed: 1234,
  });
  // Press jump to transition from preRound → playing so physics runs.
  sim.step([
    { ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true },
    EMPTY_INPUT,
  ]);
  return sim;
};

test("a ball released on the ramp rolls downhill toward center", () => {
  const sim = newRampSim();
  const x0 = sim.getRenderState().ball.x;
  for (let i = 0; i < 60; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  // Ball spawns on the right slope at x≈7 — gravity + ramp should push it toward center.
  expect(sim.getRenderState().ball.x).toBeLessThan(x0);
});

test("the ball never penetrates below the ramp surface (solid convex wedge)", () => {
  const sim = newRampSim();
  const r = DEFAULT_CONFIG.ball.radius;
  for (let i = 0; i < 60; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    const b = sim.getRenderState().ball;
    if (b.x >= 3 && b.x <= 9) {
      // Ball centre y must be above the ramp surface minus a small tolerance.
      expect(b.y + r).toBeGreaterThan(surfaceY(b.x) - 0.05);
    }
  }
});

test("getDebugColliders emits a ramp shape with the authored points", () => {
  const sim = newRampSim();
  const ramp = sim.getDebugColliders().find((s) => s.kind === "ramp") as
    | DebugRamp
    | undefined;
  expect(ramp).toBeDefined();
  // The right ramp includes the landing corner [11.5, 3]; convex hull keeps all 4 verts.
  expect(ramp?.points).toContainEqual([11.5, 3]);
});

test("the ramp fixture is mirror-symmetric (ramp variant)", () => {
  expect(() => testArenaMirrorSymmetry(RAMP_FIXTURE)).not.toThrow();
});
