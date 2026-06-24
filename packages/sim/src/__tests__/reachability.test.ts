/**
 * Reachability tests for the FLI-11 flat Flat Dojo.
 * A single floor jump now exceeds the Bell (y=6.0) — the inverse of the old
 * tall-ladder invariant. Apex includes movement.gravityScale (0.75).
 */
import { beforeAll, expect, test } from "vitest";
import { FLAT_DOJO } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import { createSimulation, initSim, type SimEvent } from "../index";
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
// (c) Integration: a jump + aerial strike can ring a Bell (added in Phase 3).
test("a basic jump + aerial Strike can ring a Bell", () => {
  // Use single-slot (activeSlots: [0]) so no opponent body blocks the ball's
  // path to the right Bell at (31, 6.0). Ball rings are geometry-only and do
  // not depend on how many slots are active.
  // Strategy: let ball settle, walk player 0 to the ball, strike rightward,
  // let ball fly. Attempt multiple times with a generous tick budget.
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
    activeSlots: [0],
  });

  let rang = false;
  const drain = () => {
    for (const e of sim.drainEvents()) {
      if ((e as SimEvent).type === "bellRing") rang = true;
    }
  };

  // Start the match.
  sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);
  drain();

  // Let ball fall from spawn (y=6, gravityScale=0.32 → ~120 ticks to reach floor).
  for (let i = 0; i < 120; i++) {
    sim.step([EMPTY_INPUT]);
    drain();
    if (rang) break;
  }

  // Make multiple grounded+aerial strike attempts over a generous budget.
  for (let attempt = 0; attempt < 25 && !rang; attempt++) {
    // Walk right to approach ball (settled near x=0 on floor).
    for (let i = 0; i < 30 && !rang; i++) {
      sim.step([{ ...EMPTY_INPUT, moveX: 1 }]);
      drain();
      const s = sim.getRenderState();
      const p = s.players[0];
      const b = s.ball;
      if (
        p &&
        Math.hypot(b.x - p.x, b.y - p.y) <= DEFAULT_CONFIG.strike.reach * 0.9
      )
        break;
    }

    // First try a grounded tap strike rightward — sends ball toward x=31.
    {
      const s = sim.getRenderState();
      const p = s.players[0];
      const b = s.ball;
      if (
        p &&
        Math.hypot(b.x - p.x, b.y - p.y) <= DEFAULT_CONFIG.strike.reach
      ) {
        sim.step([
          { ...EMPTY_INPUT, strikeHeld: true, strikePressed: true, moveX: 1 },
        ]);
        drain();
        sim.step([{ ...EMPTY_INPUT, strikeReleased: true, moveX: 1 }]);
        drain();
        // Let ball fly — generous budget.
        for (let i = 0; i < 240 && !rang; i++) {
          sim.step([EMPTY_INPUT]);
          drain();
        }
        if (rang) break;
      }
    }

    // Also try a jump + aerial strike with upward-right intent.
    // Jump right next to ball (the 3-tick window gives grace if we leave ground first).
    sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);
    drain();
    for (let i = 0; i < 3 && !rang; i++) {
      sim.step([{ ...EMPTY_INPUT, jumpHeld: true }]);
      drain();
    }
    sim.step([
      {
        ...EMPTY_INPUT,
        strikeHeld: true,
        strikePressed: true,
        moveX: 1,
        moveY: 1,
      },
    ]);
    drain();
    sim.step([{ ...EMPTY_INPUT, strikeReleased: true, moveX: 1, moveY: 1 }]);
    drain();
    for (let i = 0; i < 240 && !rang; i++) {
      sim.step([EMPTY_INPUT]);
      drain();
    }

    // Let ball settle before next attempt.
    for (let i = 0; i < 120 && !rang; i++) {
      sim.step([EMPTY_INPUT]);
      drain();
    }
  }

  // With the flat court + floaty ball + Strike window (Phase 3), a rightward
  // strike from near the ball center should ring the right Bell.
  expect(rang).toBe(true);
});

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
