/**
 * Reachability tests for the FLI-11 flat Flat Dojo.
 * A single floor jump now exceeds the Bell (y=6.0) — the inverse of the old
 * tall-ladder invariant. Apex includes movement.gravityScale (0.75).
 */
import { beforeAll, expect, test } from "vitest";
import { FLAT_DOJO } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import { createSimulation, initSim } from "../index";
import { EMPTY_INPUT, type InputFrame } from "../input";

beforeAll(async () => {
  await initSim();
});

const BELL_Y = 6.0;

// (a) Budget guard: a single baseline jump apex clears the Bell line.
test("baseline jump apex clears the Bell from the floor", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY * DEFAULT_CONFIG.movement.gravityScale; // 20·0.75 = 15
  const apexFeet = (v * v) / (2 * g); // 16.5²/30 ≈ 9.08
  expect(apexFeet).toBeGreaterThan(BELL_Y); // single jump now exceeds the Bell
});

// (b) Sim integration: a floor jump reaches Bell-threat height.
test("a floor jump reaches Bell-threat height", () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1,
    activeSlots: [0],
  });
  const halfH = DEFAULT_CONFIG.player.halfH;
  // Advance past preRound, then settle on the floor.
  sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT]);
  // Full held jump straight up; track the highest feet position reached.
  const jump: InputFrame = {
    ...EMPTY_INPUT,
    jumpPressed: true,
    jumpHeld: true,
  };
  sim.step([jump]);
  let maxFeet = -Infinity;
  for (let t = 0; t < 60; t++) {
    sim.step([{ ...EMPTY_INPUT, jumpHeld: true }]);
    const y = sim.getRenderState().players[0]?.y ?? 0;
    maxFeet = Math.max(maxFeet, y - halfH);
  }
  // Feet clear the Bell line (y=6.0) — contesting happens through jumps.
  expect(maxFeet).toBeGreaterThan(BELL_Y);
});
