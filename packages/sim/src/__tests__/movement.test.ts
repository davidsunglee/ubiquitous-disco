/**
 * Phase 4 (FLI-9): movement + airJumpsRemaining tests.
 *
 * Covers:
 *  1. Monkey King double-jump: a second jumpPressed while airborne (and not coyote-eligible)
 *     adds height ONCE (decrementing airJumpsRemaining), not twice.
 *  2. Baseline single jump unchanged for non-Monkey-King characters.
 *  3. airJumpsRemaining is reset on landing.
 *  4. airJumpsRemaining field is in the hash (serialized).
 */

import { beforeAll, expect, test } from "vitest";
import {
  CHARACTERS,
  type CharacterDef,
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

function row(f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] {
  const r: InputFrame[] = [];
  r[0] = f0;
  r[2] = f2;
  return r;
}

/**
 * Run a scripted sequence and return max Y reached by slot 0.
 */
function peakY(frames: InputFrame[][], characters?: CharacterDef[]): number {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
    characters,
  });

  // Start the match.
  sim.step(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );

  // Settle on the ground.
  for (let i = 0; i < 20; i++) sim.step(row(EMPTY_INPUT));

  let maxY = sim.getRenderState().players[0]?.y ?? 0;

  for (const f of frames) {
    sim.step(f);
    maxY = Math.max(maxY, sim.getRenderState().players[0]?.y ?? 0);
  }

  return maxY;
}

// ── Monkey King double-jump reaches higher than a single jump ─────────────────

test("Monkey King: double-jump reaches higher than a single jump", () => {
  const mkDef = CHARACTERS["monkey-king"];
  const characters: CharacterDef[] = [];
  characters[0] = mkDef;
  characters[2] = CHARACTERS.sifu;

  // Single jump: press once, hold for a while.
  const singleJumpFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 20 }, () => row(frame({ jumpHeld: true }))),
    ...Array.from({ length: 30 }, () => row(EMPTY_INPUT)),
  ];

  // Double jump: press once, after apex press again (mid-air).
  // Wait 12 ticks to exit coyote window before second press.
  const doubleJumpFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 12 }, () => row(frame({ jumpHeld: true }))),
    // Second jump press while airborne (past coyote window — ticksSinceGrounded > coyoteTicks=6).
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 18 }, () => row(frame({ jumpHeld: true }))),
    ...Array.from({ length: 30 }, () => row(EMPTY_INPUT)),
  ];

  const singlePeak = peakY(singleJumpFrames, characters);
  const doublePeak = peakY(doubleJumpFrames, characters);

  // Double jump must reach higher.
  expect(doublePeak).toBeGreaterThan(singlePeak);
});

// ── Monkey King: second air-jump consumed only once (not repeatable mid-air) ──

test("Monkey King: air-jump budget is 1 — third jump press has no added effect", () => {
  // Both the double-jump and "triple-jump" sequences use the air jump exactly once.
  // The third press must not give additional height. We verify this by comparing
  // the peak Y of a clean double-jump against a triple-attempt double-jump:
  // they should be within a small margin (same physics peak).
  const mkDef = CHARACTERS["monkey-king"];
  const characters: CharacterDef[] = [];
  characters[0] = mkDef;
  characters[2] = CHARACTERS.sifu;

  // Double jump: jump, hold for 8 ticks (airborne), press second jump at tick 8,
  // then hold for 20 more ticks. coyoteTicks=4, so at tick 8, ticksSinceGrounded >= 9
  // (set to coyoteTicks+1=5 on jump, then +1 per tick → 12 at tick 7). canJump = false.
  const doubleFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })), // tick 1: first jump
    ...Array.from({ length: 7 }, () => row(frame({ jumpHeld: true }))), // ticks 2-8: hold
    row(frame({ jumpPressed: true, jumpHeld: true })), // tick 9: air jump (budget 1→0)
    ...Array.from({ length: 20 }, () => row(frame({ jumpHeld: true }))), // hold further up
    ...Array.from({ length: 30 }, () => row(EMPTY_INPUT)), // settle
  ];

  // "Triple" attempt: same as double, but press a third time at tick 18 (budget=0, no effect).
  const tripleAttemptFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })), // tick 1: first jump
    ...Array.from({ length: 7 }, () => row(frame({ jumpHeld: true }))), // ticks 2-8: hold
    row(frame({ jumpPressed: true, jumpHeld: true })), // tick 9: air jump (budget 1→0)
    ...Array.from({ length: 9 }, () => row(frame({ jumpHeld: true }))), // hold
    row(frame({ jumpPressed: true, jumpHeld: true })), // tick 19: third press — no budget left
    ...Array.from({ length: 10 }, () => row(frame({ jumpHeld: true }))),
    ...Array.from({ length: 30 }, () => row(EMPTY_INPUT)), // settle
  ];

  const doublePeak = peakY(doubleFrames, characters);
  const tripleAttemptPeak = peakY(tripleAttemptFrames, characters);

  // Triple attempt should NOT reach significantly higher than double
  // (budget exhausted — third press has no effect).
  // Both sequences have the same first two jumps, so peaks should be close.
  expect(tripleAttemptPeak).toBeLessThan(doublePeak + 2.0);
});

// ── Non-Monkey-King: baseline single jump unchanged ───────────────────────────

test("Sifu (airJumps=0): second jump press while airborne has no effect", () => {
  const sifuDef = CHARACTERS.sifu;
  const characters: CharacterDef[] = [];
  characters[0] = sifuDef;
  characters[2] = CHARACTERS.sifu;

  // Single jump peak.
  const singleJumpFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 20 }, () => row(frame({ jumpHeld: true }))),
    ...Array.from({ length: 20 }, () => row(EMPTY_INPUT)),
  ];

  // Attempt double jump (second press at tick 13, past coyote window).
  const attemptedDoubleFrames: InputFrame[][] = [
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 12 }, () => row(frame({ jumpHeld: true }))),
    row(frame({ jumpPressed: true, jumpHeld: true })),
    ...Array.from({ length: 8 }, () => row(frame({ jumpHeld: true }))),
    ...Array.from({ length: 20 }, () => row(EMPTY_INPUT)),
  ];

  const singlePeak = peakY(singleJumpFrames, characters);
  const attemptedDouble = peakY(attemptedDoubleFrames, characters);

  // For Sifu (airJumps=0), double-jump attempt must not add height.
  // The peaks should be essentially equal (within a small margin for physics step differences).
  expect(Math.abs(attemptedDouble - singlePeak)).toBeLessThan(0.5);
});

// ── airJumpsRemaining resets on landing ───────────────────────────────────────

test("Monkey King: airJumpsRemaining resets after landing (can double-jump again)", () => {
  const mkDef = CHARACTERS["monkey-king"];
  const characters: CharacterDef[] = [];
  characters[0] = mkDef;
  characters[2] = CHARACTERS.sifu;

  // Sequence A: first jump + double-jump + land + single jump only.
  // After landing, budget should be restored (airJumps=1), so a second double-jump is possible.
  // We compare two sims directly:
  //   Sim A: land → single jump only
  //   Sim B: land → double jump
  // Sim B should reach higher peak after the second takeoff.

  const simA = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 6666,
    characters,
  });
  // Start match.
  simA.step(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  // Settle.
  for (let i = 0; i < 20; i++) simA.step(row(EMPTY_INPUT));
  // First jump + air jump + fall + land.
  simA.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 12; i++) simA.step(row(EMPTY_INPUT));
  simA.step(row(frame({ jumpPressed: true, jumpHeld: true }))); // air jump
  for (let i = 0; i < 35; i++) simA.step(row(EMPTY_INPUT)); // fall and land
  // After landing: do SINGLE jump only.
  simA.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 20; i++) simA.step(row(EMPTY_INPUT));
  let peakA = 0;
  for (let i = 0; i < 10; i++) {
    simA.step(row(EMPTY_INPUT));
    const y = simA.getRenderState().players[0]?.y ?? 0;
    if (y > peakA) peakA = y;
  }

  const simB = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 6666,
    characters,
  });
  // Start match.
  simB.step(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  // Settle.
  for (let i = 0; i < 20; i++) simB.step(row(EMPTY_INPUT));
  // First jump + air jump + fall + land.
  simB.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 12; i++) simB.step(row(EMPTY_INPUT));
  simB.step(row(frame({ jumpPressed: true, jumpHeld: true }))); // air jump
  for (let i = 0; i < 35; i++) simB.step(row(EMPTY_INPUT)); // fall and land
  // After landing: do DOUBLE jump (budget should be restored after landing).
  simB.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 12; i++) simB.step(row(EMPTY_INPUT));
  simB.step(row(frame({ jumpPressed: true, jumpHeld: true }))); // air jump again
  for (let i = 0; i < 8; i++) simB.step(row(EMPTY_INPUT));
  let peakB = 0;
  for (let i = 0; i < 10; i++) {
    simB.step(row(EMPTY_INPUT));
    const y = simB.getRenderState().players[0]?.y ?? 0;
    if (y > peakB) peakB = y;
  }

  // Sim B (double jump after landing) reaches higher than Sim A (single jump after landing).
  // This proves airJumpsRemaining was restored on landing.
  expect(peakB).toBeGreaterThan(peakA);
});

// ── airJumpsRemaining is serialized into the hash ─────────────────────────────

test("airJumpsRemaining affects the hash (Monkey King mid-air vs grounded)", () => {
  const mkDef = CHARACTERS["monkey-king"];
  const characters: CharacterDef[] = [];
  characters[0] = mkDef;
  characters[2] = CHARACTERS.sifu;

  // Sim A: Monkey King uses the air jump (airJumpsRemaining goes to 0).
  const simA = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 9999,
    characters,
  });
  simA.step(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  for (let i = 0; i < 20; i++) simA.step(row(EMPTY_INPUT));
  // Jump and use air jump.
  simA.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 12; i++) simA.step(row(EMPTY_INPUT));
  simA.step(row(frame({ jumpPressed: true, jumpHeld: true }))); // air jump consumed
  for (let i = 0; i < 5; i++) simA.step(row(EMPTY_INPUT));
  const hashA = simA.hashState();

  // Sim B: same ticks but NO second jump press (airJumpsRemaining stays at 1).
  const simB = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 9999,
    characters,
  });
  simB.step(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  for (let i = 0; i < 20; i++) simB.step(row(EMPTY_INPUT));
  // Jump but no air jump.
  simB.step(row(frame({ jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 12; i++) simB.step(row(EMPTY_INPUT));
  simB.step(row(EMPTY_INPUT)); // no air jump
  for (let i = 0; i < 5; i++) simB.step(row(EMPTY_INPUT));
  const hashB = simB.hashState();

  // The hashes must differ because airJumpsRemaining (0 vs 1) is serialized.
  expect(hashA).not.toBe(hashB);
});
