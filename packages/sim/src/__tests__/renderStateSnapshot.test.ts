/**
 * getRenderState snapshot-independence (#7).
 *
 * NetLoop/GameScene capture getRenderState() each predicted tick for lerp
 * rendering. They previously deep-copied the result with structuredClone. That
 * is only safe to drop if getRenderState() already returns a fresh object that
 * does NOT alias internal sim state — i.e. a later step() must not mutate a
 * previously captured snapshot. This test pins that contract.
 */

import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  initSim,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function newSim() {
  return createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });
}

test("getRenderState() returns a snapshot that a later step() does not mutate", () => {
  const sim = newSim();
  // Start the match and let the ball move so positions actually change.
  sim.step([
    { ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true },
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  const captured = sim.getRenderState();
  const ballXBefore = captured.ball.x;
  const ballYBefore = captured.ball.y;
  const p0xBefore = captured.players[0]?.x;

  // Advance the sim; the captured snapshot must remain frozen.
  for (let i = 0; i < 20; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  expect(captured.ball.x).toBe(ballXBefore);
  expect(captured.ball.y).toBe(ballYBefore);
  expect(captured.players[0]?.x).toBe(p0xBefore);
});

test("two getRenderState() calls return independent objects", () => {
  const sim = newSim();
  sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  const a = sim.getRenderState();
  const b = sim.getRenderState();

  expect(a).not.toBe(b);
  expect(a.ball).not.toBe(b.ball);
  expect(a.players).not.toBe(b.players);
  expect(a.players[0]).not.toBe(b.players[0]);
});
