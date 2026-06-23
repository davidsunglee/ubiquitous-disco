import { beforeAll, expect, test } from "vitest";
import {
  CHARACTERS,
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
 * Returns per-tick rows (slot 0 moves, slot 1 is idle).
 */
function scriptedFrames(): InputFrame[][] {
  const frames: InputFrame[][] = [];
  // walk right for 15 ticks
  for (let i = 0; i < 15; i++) frames.push([frame({ moveX: 1 }), EMPTY_INPUT]);
  // full-height jump: press on tick 0, then keep holding while moving right
  frames.push([
    frame({ moveX: 1, jumpPressed: true, jumpHeld: true }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 25; i++)
    frames.push([frame({ moveX: 1, jumpHeld: true }), EMPTY_INPUT]);
  // settle back on the ground
  for (let i = 0; i < 20; i++) frames.push([frame({}), EMPTY_INPUT]);
  // tapped jump: press for a single tick, release immediately (cut velocity)
  frames.push([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  for (let i = 0; i < 25; i++) frames.push([frame({}), EMPTY_INPUT]);
  // run left into the left wall
  for (let i = 0; i < 40; i++) frames.push([frame({ moveX: -1 }), EMPTY_INPUT]);
  return frames;
}

/** Create a sim already in "playing" phase (Start pressed). */
function newSim(): ReturnType<typeof createSimulation> {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  return sim;
}

function run(frames: InputFrame[][]): string {
  const sim = newSim();
  for (const f of frames) sim.step(f);
  return sim.hashState();
}

test("falling-ball sim is deterministic across runs", () => {
  const frames = Array.from({ length: 120 }, () => [EMPTY_INPUT, EMPTY_INPUT]);
  expect(run(frames)).toBe(run(frames));
});

test("scripted move/jump session produces an equal composite hash across runs", () => {
  const frames = scriptedFrames();
  expect(run(frames)).toBe(run(frames));
});

test("ball falls from spawn under gravity", () => {
  const sim = newSim();
  const startY = sim.getRenderState().ball.y;
  for (let i = 0; i < 30; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  expect(sim.getRenderState().ball.y).toBeLessThan(startY);
});

test("player moves left and stops at the left wall", () => {
  const sim = newSim();
  const startX = sim.getRenderState().players[0]?.x ?? 0;
  // FLAT_DOJO is now 72 units wide (wall inner face at x = -35.5). Move LEFT,
  // away from the centre ball, so the player travels freely to the far wall.
  for (let i = 0; i < 600; i++) sim.step([frame({ moveX: -1 }), EMPTY_INPUT]);
  const endX = sim.getRenderState().players[0]?.x ?? 0;
  expect(endX).toBeLessThan(startX);
  // left wall inner face is at x = -35.5; player halfW 0.4 → cannot pass ~-35.1
  expect(endX).toBeLessThan(-34);
  expect(endX).toBeGreaterThan(-35.2);
  expect(sim.getRenderState().players[0]?.facing).toBe(-1);
});

test("held jump rises higher than a tapped jump", () => {
  const peak = (jumpFrames: InputFrame[][]): number => {
    const sim = newSim();
    // let the player settle on the floor first
    for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    let maxY = sim.getRenderState().players[0]?.y ?? 0;
    for (const f of jumpFrames) {
      sim.step(f);
      maxY = Math.max(maxY, sim.getRenderState().players[0]?.y ?? 0);
    }
    return maxY;
  };

  const held: InputFrame[][] = [
    [frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT],
    ...Array.from({ length: 30 }, () => [
      frame({ jumpHeld: true }),
      EMPTY_INPUT,
    ]),
  ];
  const tapped: InputFrame[][] = [
    [frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT],
    ...Array.from({ length: 30 }, () => [EMPTY_INPUT, EMPTY_INPUT]),
  ];

  expect(peak(held)).toBeGreaterThan(peak(tapped));
});

// ── Phase 3 (FLI-9): seeded RNG determinism ─────────────────────────────────

/**
 * Build a frame list where slot 0 (Drunken Boxer) fires Stagger Stumble once,
 * then both players idle.
 */
function buildDrunkenBoxerFrames(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  function row(f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = f0;
    r[2] = f2;
    return r;
  }

  // Start the match.
  frames.push(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  // Settle for 20 ticks.
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT));
  // Walk toward center (ball).
  for (let i = 0; i < 10; i++) frames.push(row(frame({ moveX: 1 })));
  // Fire Stagger Stumble.
  frames.push(row(frame({ specialPressed: true, specialHeld: true })));
  // Idle for 40 ticks.
  for (let i = 0; i < 40; i++) frames.push(row(EMPTY_INPUT));
  return frames;
}

test("Phase 3: same seed + same Drunken-Boxer inputs → same hashState", () => {
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerFrames();

  const runOnce = () => {
    const sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 7777,
      characters: [drunkenBoxerDef],
    });
    for (const f of frames) sim.step(f);
    return sim.hashState();
  };

  expect(runOnce()).toBe(runOnce());
});

test("Phase 3: different seed → different hashState after a Stagger Stumble", () => {
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerFrames();

  const runWithSeed = (seed: number) => {
    const sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed,
      characters: [drunkenBoxerDef],
    });
    for (const f of frames) sim.step(f);
    return sim.hashState();
  };

  // Different seeds produce different PRNG sequences → different stagger-stumble
  // directions → different physics outcomes → different hashes.
  expect(runWithSeed(1111)).not.toBe(runWithSeed(2222));
});
