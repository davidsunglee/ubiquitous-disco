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

function frame(p: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...p };
}

function newSim() {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 77,
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  return sim;
}

test("two scripted input streams are deterministic across two sims", () => {
  const run = () => {
    const sim = newSim();
    for (let i = 0; i < 90; i++) {
      sim.step([frame({ moveX: 1 }), frame({ moveX: -1 })]);
    }
    return sim.hashState();
  };
  expect(run()).toBe(run());
});

test("players pass through each other (no body blocking) but stay on the floor", () => {
  const sim = newSim();
  // Slot 0 spawns left (-4), slot 1 right (+4). Drive them toward each other.
  for (let i = 0; i < 120; i++) {
    sim.step([frame({ moveX: 1 }), frame({ moveX: -1 })]);
  }
  const s = sim.getRenderState();
  const p0 = s.players[0];
  const p1 = s.players[1];
  if (!p0 || !p1) throw new Error("Missing player slots in render state");

  // If bodies blocked, slot 0 would stay left of slot 1. Pass-through lets them cross.
  expect(p0.x).toBeGreaterThan(p1.x);
  // Both still resting on the floor (grounded = true, not fallen through).
  expect(p0.grounded).toBe(true);
  expect(p1.grounded).toBe(true);
});

test("each slot's render state reflects its own actor (facing independent)", () => {
  const sim = newSim();
  // Let them settle on the ground first.
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  // P1 faces right, P2 faces left (their initial facing from createActor).
  const s = sim.getRenderState();
  expect(s.players[0]?.facing).toBe(1);
  expect(s.players[1]?.facing).toBe(-1);
});

test("snapshot/restore works with two player bodies", () => {
  const sim = newSim();
  // Walk both players for a bit.
  for (let i = 0; i < 30; i++) {
    sim.step([frame({ moveX: 1 }), frame({ moveX: -1 })]);
  }
  const snap = sim.takeSnapshot();
  const stateAfterSnap = sim.getRenderState();

  // Step a few more ticks to diverge.
  for (let i = 0; i < 10; i++) {
    sim.step([frame({ moveX: -1 }), frame({ moveX: 1 })]);
  }
  // Restore and check we're back to the snapshot state.
  sim.restoreSnapshot(snap);
  expect(sim.getRenderState()).toEqual(stateAfterSnap);
});
