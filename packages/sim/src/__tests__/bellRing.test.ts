import { beforeAll, expect, test } from "vitest";
import type { ArenaDef, CircleZone } from "../arena";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
} from "../index";
import {
  type BellRingState,
  circleOverlap,
  createBellRingState,
  serializeBellRingState,
  stepBellRing,
} from "../rules/bellRing";

beforeAll(async () => {
  await initSim();
});

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

function newSim() {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
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
  const state: BellRingState = { armed: [true, false] };
  expect(Array.from(serializeBellRingState(state))).toEqual([1, 0]);
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
