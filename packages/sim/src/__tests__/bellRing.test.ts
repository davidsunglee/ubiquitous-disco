import { beforeAll, expect, test } from "vitest";
import type { ArenaDef, CircleZone } from "../arena";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  type InputFrame,
  initSim,
} from "../index";
import {
  advancePressureRamp,
  type BellRingState,
  circleOverlap,
  createBellRingState,
  serializeBellRingState,
  stepBellRing,
} from "../rules/bellRing";
import { COMPACT_DOJO } from "./fixtures/compactArena";

beforeAll(async () => {
  await initSim();
});

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

function newSim() {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: COMPACT_DOJO,
    seed: 4242,
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  return sim;
}

// ── Pure overlap geometry ────────────────────────────────────────────────────

const ZONE: CircleZone = { kind: "circle", x: 5, y: 5, radius: 1 };
const R = 0.5; // ball radius for these geometry cases

test("ball centered inside the hit-zone overlaps", () => {
  expect(circleOverlap(5, 5, R, ZONE)).toBe(true);
});

test("ball fully outside the hit-zone does not overlap", () => {
  // 3 units away horizontally — well beyond radius (1) + ball radius (0.5).
  expect(circleOverlap(8, 5, R, ZONE)).toBe(false);
});

test("ball just touching the edge overlaps (inclusive boundary)", () => {
  // Distance exactly radius + ballRadius = 1.5 to the right.
  expect(circleOverlap(5 + 1.5, 5, R, ZONE)).toBe(true);
});

test("ball a hair past the edge does not overlap", () => {
  expect(circleOverlap(5 + 1.5 + 1e-3, 5, R, ZONE)).toBe(false);
});

// ── Debounce: one ring per contact, re-arm on exit ───────────────────────────

const ONE_BELL: ArenaDef = {
  id: "test",
  colliders: [],
  bells: [
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 5, y: 5, halfW: 0.5, halfH: 0.5 },
      hitZone: { kind: "circle", x: 5, y: 5, radius: 1 },
    },
  ],
  playerSpawns: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  playerSpawn: { x: 0, y: 0 },
  ballSpawn: { x: 0, y: 0 },
};

test("a single contact rings exactly once, then re-arms after leaving", () => {
  const state: BellRingState = createBellRingState(ONE_BELL);

  // Outside: no ring, stays armed.
  expect(stepBellRing(ONE_BELL, 0, 0, R, state)).toHaveLength(0);
  expect(state.armed[0]).toBe(true);

  // Enter the zone: rings once and disarms.
  const first = stepBellRing(ONE_BELL, 5, 5, R, state);
  expect(first).toHaveLength(1);
  expect(first[0]?.bell).toBe("right");
  expect(state.armed[0]).toBe(false);

  // Still inside on the next tick: debounced, no repeat ring.
  expect(stepBellRing(ONE_BELL, 5, 5, R, state)).toHaveLength(0);

  // Leave the zone: re-arms, no ring on exit.
  expect(stepBellRing(ONE_BELL, 0, 0, R, state)).toHaveLength(0);
  expect(state.armed[0]).toBe(true);

  // Re-enter: rings again.
  expect(stepBellRing(ONE_BELL, 5, 5, R, state)).toHaveLength(1);
});

test("Bells are tested independently and reported in array order", () => {
  const rightBell = ONE_BELL.bells[0];
  if (!rightBell) throw new Error("fixture missing right Bell");
  const twoBells: ArenaDef = {
    ...ONE_BELL,
    bells: [
      {
        id: "left",
        defends: "left",
        art: { kind: "box", x: -5, y: 5, halfW: 0.5, halfH: 0.5 },
        hitZone: { kind: "circle", x: -5, y: 5, radius: 1 },
      },
      rightBell,
    ],
  };
  const state = createBellRingState(twoBells);
  // Ball sitting on the left Bell only.
  const hits = stepBellRing(twoBells, -5, 5, R, state);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.bell).toBe("left");
  expect(state.armed[0]).toBe(false);
  expect(state.armed[1]).toBe(true);
});

test("serializeBellRingState reflects per-Bell armed flags in order", () => {
  const state: BellRingState = {
    armed: [true, false],
    radiusBonus: 0,
    rampTicks: 0,
  };
  // First two bytes are the armed flags; the rest are radiusBonus (f64) + rampTicks (i32).
  const bytes = Array.from(serializeBellRingState(state));
  expect(bytes[0]).toBe(1); // armed[0] = true
  expect(bytes[1]).toBe(0); // armed[1] = false
  expect(bytes.length).toBe(2 + 8 + 4); // armed + f64 + i32
});

// ── Replay-style: upward Strike into an elevated Bell, hash-equal across runs ─

// Walk the player next to the (settled) ball so a Strike is within reach, then a
// partial-charge up-right Strike pops it into the right Bell at (9, 5).
function ringRightBell(sim: ReturnType<typeof newSim>): void {
  for (let i = 0; i < 40; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  for (let i = 0; i < 40; i++) {
    sim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const s = sim.getRenderState();
    const p = s.players[0];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
  }
  sim.step([
    frame({ strikeHeld: true, strikePressed: true, moveX: 1, moveY: 1 }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 8; i++) {
    sim.step([frame({ strikeHeld: true, moveX: 1, moveY: 1 }), EMPTY_INPUT]);
  }
  sim.step([frame({ strikeReleased: true, moveX: 1, moveY: 1 }), EMPTY_INPUT]);
}

test("an upward Strike into the elevated right Bell emits a bellRing event", () => {
  const sim = newSim();
  ringRightBell(sim);

  let rang: { bell: "left" | "right"; tick: number } | null = null;
  for (let i = 0; i < 160; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    const events = sim.drainEvents();
    const hit = events.find((e) => e.type === "bellRing");
    if (hit) {
      rang = { bell: hit.bell, tick: hit.tick };
      break;
    }
  }

  expect(rang).not.toBeNull();
  expect(rang?.bell).toBe("right");
});

test("the scripted Bell-ring run is hash-equal across two runs", () => {
  const run = (): string => {
    const sim = newSim();
    ringRightBell(sim);
    for (let i = 0; i < 160; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    return sim.hashState();
  };
  expect(run()).toBe(run());
});

// ── Phase-6: Overtime Pressure Ramp ─────────────────────────────────────────

test("advancePressureRamp: no growth before rampIntervalTicks", () => {
  const state: BellRingState = { armed: [true], radiusBonus: 0, rampTicks: 0 };
  const interval = DEFAULT_CONFIG.overtime.rampIntervalTicks;
  // Step interval-1 ticks: radiusBonus should still be 0.
  for (let i = 0; i < interval - 1; i++) {
    advancePressureRamp(state, DEFAULT_CONFIG);
  }
  expect(state.radiusBonus).toBe(0);
  expect(state.rampTicks).toBe(interval - 1);
});

test("advancePressureRamp: grows by rampStepRadius at the interval", () => {
  const state: BellRingState = { armed: [true], radiusBonus: 0, rampTicks: 0 };
  const interval = DEFAULT_CONFIG.overtime.rampIntervalTicks;
  // Step exactly interval ticks: should get one step of growth.
  for (let i = 0; i < interval; i++) {
    advancePressureRamp(state, DEFAULT_CONFIG);
  }
  expect(state.radiusBonus).toBeCloseTo(DEFAULT_CONFIG.overtime.rampStepRadius);
  expect(state.rampTicks).toBe(0); // reset after step
});

test("advancePressureRamp: capped at rampMaxBonus", () => {
  const state: BellRingState = { armed: [true], radiusBonus: 0, rampTicks: 0 };
  const interval = DEFAULT_CONFIG.overtime.rampIntervalTicks;
  const maxSteps = Math.ceil(
    DEFAULT_CONFIG.overtime.rampMaxBonus /
      DEFAULT_CONFIG.overtime.rampStepRadius,
  );
  // Step many intervals past the cap.
  for (let i = 0; i < interval * (maxSteps + 5); i++) {
    advancePressureRamp(state, DEFAULT_CONFIG);
  }
  expect(state.radiusBonus).toBeLessThanOrEqual(
    DEFAULT_CONFIG.overtime.rampMaxBonus + 1e-9,
  );
  expect(state.radiusBonus).toBeCloseTo(DEFAULT_CONFIG.overtime.rampMaxBonus);
});

test("radiusBonus makes ball-inside detection true at greater distance", () => {
  const base: BellRingState = {
    armed: [true, true],
    radiusBonus: 0,
    rampTicks: 0,
  };
  const grown: BellRingState = {
    armed: [true, true],
    radiusBonus: 1.0,
    rampTicks: 0,
  };
  const ballR = 0.3;
  // Ball at (5 + 1.0 + ballR + 0.05, 5): just outside the base radius but inside grown.
  const ballX = 5 + 1.0 + ballR + 0.05;
  expect(
    circleOverlap(ballX, 5, ballR, { kind: "circle", x: 5, y: 5, radius: 1.0 }),
  ).toBe(false);
  // With radiusBonus, stepBellRing should detect a hit.
  const hits = stepBellRing(ONE_BELL, ballX, 5, ballR, grown);
  expect(hits).toHaveLength(1);
  // But with no bonus, same ball position does NOT ring.
  const noHits = stepBellRing(ONE_BELL, ballX, 5, ballR, base);
  expect(noHits).toHaveLength(0);
});

test("serializeBellRingState encodes non-zero radiusBonus and rampTicks", () => {
  const state: BellRingState = {
    armed: [true],
    radiusBonus: 0.8,
    rampTicks: 450,
  };
  const bytes = serializeBellRingState(state);
  // Should be 1 (armed) + 8 (f64) + 4 (i32) = 13 bytes.
  expect(bytes.length).toBe(13);
  // Parse back: armed byte at offset 0.
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  expect(view.getUint8(0)).toBe(1); // armed[0] = true
  expect(view.getFloat64(1)).toBeCloseTo(0.8);
  expect(view.getInt32(9)).toBe(450);
});

test("takeSnapshot/restoreSnapshot preserves radiusBonus and rampTicks", () => {
  // Use a very short rampIntervalTicks so we can reach a non-zero bonus quickly.
  const fastConfig = {
    ...DEFAULT_CONFIG,
    match: {
      ...DEFAULT_CONFIG.match,
      lengthTicks: 5,
      scoringPauseTicks: 0,
      resetTicks: 0,
      goldenGoal: true,
    },
    overtime: { rampIntervalTicks: 3, rampStepRadius: 0.4, rampMaxBonus: 1.6 },
  };
  const sim = createSimulation({
    config: fastConfig,
    arena: COMPACT_DOJO,
    seed: 1,
  });
  // Start the match.
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[2] = EMPTY_INPUT;
  sim.step(startRow);
  // Run until golden goal (timer expires at 0-0).
  for (let i = 0; i < 30; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
    if (sim.getMatchState().phase === "goldenGoal") break;
  }
  expect(sim.getMatchState().phase).toBe("goldenGoal");
  // Step a few ticks so rampTicks accumulates.
  for (let i = 0; i < 4; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
  }
  // Take snapshot and check that bonus grew (4 ticks > rampIntervalTicks=3).
  const snap = sim.takeSnapshot();
  expect(snap.bellRingState).toBeDefined();
  expect(snap.bellRingState!.radiusBonus).toBeGreaterThan(0);

  // Now step a few more ticks to advance further.
  for (let i = 0; i < 10; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
  }
  const hashAfter = sim.hashState();

  // Restore the snapshot.
  sim.restoreSnapshot(snap);
  // Re-step the same 10 ticks.
  for (let i = 0; i < 10; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
  }
  // Hash must be identical — the ramp restored correctly.
  expect(sim.hashState()).toBe(hashAfter);
});

test("ramp grows only in goldenGoal, not in playing phase", () => {
  const fastConfig = {
    ...DEFAULT_CONFIG,
    match: { ...DEFAULT_CONFIG.match, lengthTicks: 5400, goldenGoal: true },
    overtime: { rampIntervalTicks: 5, rampStepRadius: 0.4, rampMaxBonus: 1.6 },
  };
  const sim = createSimulation({
    config: fastConfig,
    arena: COMPACT_DOJO,
    seed: 1,
  });
  // Start.
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[2] = EMPTY_INPUT;
  sim.step(startRow);
  expect(sim.getMatchState().phase).toBe("playing");
  // Step enough ticks (well past rampIntervalTicks) — radius must NOT grow during playing.
  for (let i = 0; i < 20; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
  }
  expect(sim.getMatchState().phase).toBe("playing");
  // getBellHitRadii should equal the static arena radii (no bonus).
  const radii = sim.getBellHitRadii();
  for (const r of radii) {
    expect(r).toBeCloseTo(COMPACT_DOJO.bells[0]?.hitZone.radius ?? 0.8);
  }
});

test("golden goal still ends on next Bell Ring after ramp grows", () => {
  const fastConfig = {
    ...DEFAULT_CONFIG,
    match: {
      ...DEFAULT_CONFIG.match,
      lengthTicks: 5,
      scoringPauseTicks: 0,
      resetTicks: 0,
      goldenGoal: true,
    },
    overtime: { rampIntervalTicks: 3, rampStepRadius: 0.4, rampMaxBonus: 1.6 },
  };
  const sim = createSimulation({
    config: fastConfig,
    arena: COMPACT_DOJO,
    seed: 1,
  });
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[2] = EMPTY_INPUT;
  sim.step(startRow);
  // Run until golden goal.
  for (let i = 0; i < 30; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
    if (sim.getMatchState().phase === "goldenGoal") break;
  }
  expect(sim.getMatchState().phase).toBe("goldenGoal");
  // Ring a bell (should end the match regardless of bonus).
  ringRightBell(sim);
  let reachedComplete = false;
  for (let i = 0; i < 200; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
    if (sim.getMatchState().phase === "complete") {
      reachedComplete = true;
      break;
    }
  }
  expect(reachedComplete).toBe(true);
  expect(sim.getMatchState().winner).not.toBe(-1);
});

test("getBellHitRadii reflects grown radius during golden goal (fast config)", () => {
  const fastConfig = {
    ...DEFAULT_CONFIG,
    match: {
      ...DEFAULT_CONFIG.match,
      lengthTicks: 5,
      scoringPauseTicks: 0,
      resetTicks: 0,
      goldenGoal: true,
    },
    overtime: { rampIntervalTicks: 1, rampStepRadius: 0.5, rampMaxBonus: 2.0 },
  };
  const sim = createSimulation({
    config: fastConfig,
    arena: COMPACT_DOJO,
    seed: 1,
  });
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[2] = EMPTY_INPUT;
  sim.step(startRow);
  // Run into golden goal.
  for (let i = 0; i < 30; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
    if (sim.getMatchState().phase === "goldenGoal") break;
  }
  expect(sim.getMatchState().phase).toBe("goldenGoal");
  // Step a few ticks to allow ramp to grow (interval=1 tick).
  for (let i = 0; i < 5; i++) {
    const emptyRow: InputFrame[] = [];
    emptyRow[0] = EMPTY_INPUT;
    emptyRow[2] = EMPTY_INPUT;
    sim.step(emptyRow);
  }
  const radii = sim.getBellHitRadii();
  const baseRadius = COMPACT_DOJO.bells[0]?.hitZone.radius ?? 0.8;
  for (const r of radii) {
    expect(r).toBeGreaterThan(baseRadius);
  }
});
