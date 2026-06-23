/**
 * Reachability tests for the FLI-9 tall Flat Dojo redesign.
 *
 * (a) A config-level budget guard that ensures jumpSpeed 12 clears the low step
 *     (top 3.0u) but cannot single-jump to the bell (8.5u), and that a floor
 *     jump + up air-dash still falls short of the bell.
 * (b) A sim integration test that walks a default (slot 0) actor to the low
 *     step and verifies it lands on the platform.
 */

import { beforeAll, expect, test } from "vitest";
import { FLAT_DOJO } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import { createSimulation, initSim } from "../index";
import { EMPTY_INPUT, type InputFrame } from "../input";

beforeAll(async () => {
  await initSim();
});

// (a) Budget guard: a single baseline jump clears the low-step top (3.0u of feet).
test("baseline jump apex clears the low step but not the bell", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY;
  const apexFeet = (v * v) / (2 * g); // 12²/40 = 3.6
  expect(apexFeet).toBeGreaterThan(3.0); // lands low step (top 3.0)
  expect(apexFeet).toBeLessThan(8.5); // never single-jumps to the bell
  // Floor jump + up air-dash (≈ apex + dashDistance) still short of the 8.5 bell.
  expect(apexFeet + DEFAULT_CONFIG.dash.distance).toBeLessThan(8.5); // 6.6 < 8.5
});

// (b) Sim integration: an actor on the floor under the low step jumps onto it.
test("an actor reaches the low step with a single jump", () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1,
    activeSlots: [0],
  });
  const moveRight: InputFrame = { ...EMPTY_INPUT, moveX: 1 };
  // Advance past preRound (any jumpPressed transitions to "playing").
  sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);
  // Settle on the ground for a few ticks.
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT]);
  // Walk toward the low step (centre x=22, spans x=19.5..24.5, top y=3.0).
  // When approaching from the left, execute a full held jump (hold jumpHeld for
  // ~20 ticks) so the jump-cut multiplier doesn't trim the arc prematurely.
  // 400 ticks gives plenty of room even if the ball slows the player briefly.
  let jumpTicksRemaining = 0;
  for (let t = 0; t < 400; t++) {
    const px = sim.getRenderState().players[0]?.x ?? 0;
    const pGrounded = sim.getRenderState().players[0]?.grounded ?? false;
    // Trigger a jump when just left of the step left edge (x=19.5) and grounded.
    if (px > 17 && px < 19.5 && pGrounded && jumpTicksRemaining === 0) {
      jumpTicksRemaining = 20; // hold jump for 20 ticks to reach full apex
    }
    let action: InputFrame;
    if (jumpTicksRemaining > 0) {
      action = {
        ...EMPTY_INPUT,
        moveX: 1,
        jumpHeld: true,
        jumpPressed: jumpTicksRemaining === 20, // only press on the first tick
      };
      jumpTicksRemaining--;
    } else {
      action = moveRight;
    }
    sim.step([action]);
    const curY = sim.getRenderState().players[0]?.y ?? 0;
    const curGrounded = sim.getRenderState().players[0]?.grounded ?? false;
    // Success: grounded on the low step (feet = 3.0 → body centre = 3.0 + halfH = 3.8).
    if (curGrounded && curY > 3.0) {
      expect(curY).toBeGreaterThan(3.0);
      return;
    }
  }
  throw new Error("actor never landed on the low step");
});
