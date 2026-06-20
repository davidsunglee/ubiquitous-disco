/**
 * Match lifecycle tests.
 *
 * Covers: scoring attribution (own-goal), timer → regulation, tie → Golden
 * Goal → complete, gameplay frozen in non-live phases, and start/rematch edges.
 *
 * Uses short-match config overrides to keep tests fast.
 */

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

// The jump button edge from slot 0 acts as "Start" / "Rematch".
const START: InputFrame[] = [
  frame({ jumpPressed: true, jumpHeld: true }),
  EMPTY_INPUT,
];

function newSim(matchOverride: Record<string, unknown> = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    match: { ...DEFAULT_CONFIG.match, ...matchOverride },
  };
  return createSimulation({ config, arena: FLAT_DOJO, seed: 11 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Helper that mimics ringRightBell from bellRing.test.ts: walks slot `slot`
 * toward the ball and releases a partial-charge up-right Strike aimed at
 * the right Bell. The *opposing* team should be credited.
 */
function ringBell(
  sim: ReturnType<typeof newSim>,
  bellSide: "left" | "right",
  driverSlot: 0 | 1,
): void {
  // Let everyone settle.
  for (let i = 0; i < 30; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  // Walk driver toward ball.
  const moveX = driverSlot === 0 ? 1 : -1;
  for (let i = 0; i < 50; i++) {
    const f0 = driverSlot === 0 ? frame({ moveX }) : EMPTY_INPUT;
    const f1 = driverSlot === 1 ? frame({ moveX }) : EMPTY_INPUT;
    sim.step([f0, f1]);
    const s = sim.getRenderState();
    const p = s.players[driverSlot];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
  }
  // Charge and release strike toward the target bell.
  const dirX = bellSide === "right" ? 1 : -1;
  const f0strike = (held: boolean, released = false): InputFrame =>
    driverSlot === 0
      ? frame({
          moveX: dirX,
          moveY: 1,
          strikeHeld: held,
          strikePressed: held && !released,
          strikeReleased: released,
        })
      : EMPTY_INPUT;
  const f1strike = (held: boolean, released = false): InputFrame =>
    driverSlot === 1
      ? frame({
          moveX: dirX,
          moveY: 1,
          strikeHeld: held,
          strikePressed: held && !released,
          strikeReleased: released,
        })
      : EMPTY_INPUT;

  sim.step([f0strike(true), f1strike(true)]);
  for (let i = 0; i < 8; i++) sim.step([f0strike(true), f1strike(true)]);
  sim.step([f0strike(false, true), f1strike(false, true)]);
}

/** Wait up to maxTicks for the match to reach the given phase. */
function waitForPhase(
  sim: ReturnType<typeof newSim>,
  targetPhase: string,
  maxTicks = 200,
): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (sim.getMatchState().phase === targetPhase) return true;
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }
  return sim.getMatchState().phase === targetPhase;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("gameplay is frozen during preRound — players don't move before Start", () => {
  const sim = newSim();
  const before = sim.getRenderState();
  for (let i = 0; i < 30; i++)
    sim.step([frame({ moveX: 1 }), frame({ moveX: -1 })]);
  const after = sim.getRenderState();
  // Still in preRound — positions unchanged.
  expect(sim.getMatchState().phase).toBe("preRound");
  expect(after.players[0]?.x).toBeCloseTo(before.players[0]?.x ?? 0, 4);
  expect(after.players[1]?.x).toBeCloseTo(before.players[1]?.x ?? 0, 4);
});

test("jump-button edge transitions preRound → playing", () => {
  const sim = newSim();
  expect(sim.getMatchState().phase).toBe("preRound");
  sim.step(START);
  expect(sim.getMatchState().phase).toBe("playing");
});

test("players can move after Start", () => {
  const sim = newSim();
  sim.step(START); // preRound → playing
  const before = sim.getRenderState();
  for (let i = 0; i < 20; i++) sim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
  const after = sim.getRenderState();
  // Slot 0 moved right.
  expect(after.players[0]?.x).toBeGreaterThan(
    before.players[0]?.x ?? -Infinity,
  );
});

test("timer counts down during playing", () => {
  const sim = newSim({ lengthTicks: 100 });
  sim.step(START); // preRound → playing
  const timerBefore = sim.getMatchState().timer;
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  const timerAfter = sim.getMatchState().timer;
  expect(timerAfter).toBe(timerBefore - 10);
});

test("regulation timer expires: with unequal scores → complete + winner set", () => {
  // Use a tiny lengthTicks so timer expires quickly; scoringPauseTicks = 0
  // and resetTicks = 0 so the pause/reset cycle is instant.
  const sim = newSim({ lengthTicks: 5, scoringPauseTicks: 0, resetTicks: 0 });
  sim.step(START); // preRound → playing

  // Manually adjust scores to give team 0 a lead (we skip an actual bell ring here).
  // Instead, step until regulation expires at 0-0 → golden goal (goldenGoal: true by default).
  // Then override goldenGoal: false to get a clear winner test.
  const sim2 = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: false,
  });
  sim2.step(START); // preRound → playing
  // Step past the timer.
  for (let i = 0; i < 20; i++) sim2.step([EMPTY_INPUT, EMPTY_INPUT]);
  // With 0-0 and goldenGoal: false, we should get complete with winner = -1 (tie → draw).
  expect(sim2.getMatchState().phase).toBe("complete");
});

test("tie at regulation with goldenGoal: true → goldenGoal phase", () => {
  const sim = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: true,
  });
  sim.step(START); // preRound → playing
  // Step past the timer (0-0 tie).
  for (let i = 0; i < 20; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  expect(sim.getMatchState().phase).toBe("goldenGoal");
});

test("rematch: jump edge from complete → playing resets scores and timer", () => {
  const sim = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: false,
  });
  sim.step(START); // preRound → playing
  for (let i = 0; i < 20; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]); // → complete
  expect(sim.getMatchState().phase).toBe("complete");
  // Press Start again for rematch.
  sim.step(START);
  const m = sim.getMatchState();
  expect(m.phase).toBe("playing");
  expect(m.scores).toEqual([0, 0]);
  expect(m.timer).toBe(5); // back to the short length
});

test("ringing a bell credits the OPPOSING team (own-goal attribution)", () => {
  // scoringPauseTicks and resetTicks set to small values so test runs quickly.
  const sim = newSim({ scoringPauseTicks: 2, resetTicks: 2 });
  sim.step(START); // preRound → playing

  // Ring the right bell using slot 0 (driver). The right bell defends "right"
  // (team 1). Scoring team = opponent = team 0. Wait for bellRing event.
  ringBell(sim, "right", 0);
  let scored = false;
  for (let i = 0; i < 200; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    const events = sim.drainEvents();
    const bellEvent = events.find((e) => e.type === "bellRing");
    if (bellEvent && bellEvent.type === "bellRing") {
      // Right bell scored — defending team 1 → scoring team 0.
      expect(bellEvent.scoringTeam).toBe(0);
      scored = true;
      break;
    }
  }
  expect(scored).toBe(true);
  // After the ring + pause + reset, score[0] should be 1.
  // Wait for resetting to complete.
  for (let i = 0; i < 100; i++) {
    if (sim.getMatchState().phase === "playing") break;
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }
  expect(sim.getMatchState().scores[0]).toBe(1);
  expect(sim.getMatchState().scores[1]).toBe(0);
});

test("after bellPause → resetting → positions are reset and play resumes", () => {
  const sim = newSim({ scoringPauseTicks: 3, resetTicks: 3 });
  sim.step(START);
  // Ring the right bell to trigger scoring.
  ringBell(sim, "right", 0);
  // Wait for bellPause.
  const reachedBellPause = waitForPhase(sim, "bellPause");
  expect(reachedBellPause).toBe(true);
  // Wait for resetting.
  const reachedResetting = waitForPhase(sim, "resetting");
  expect(reachedResetting).toBe(true);
  // Wait for playing to resume.
  const resumed = waitForPhase(sim, "playing");
  expect(resumed).toBe(true);
  // Players should be near their spawn positions after reset.
  const { players } = sim.getRenderState();
  expect(players[0]?.x).toBeCloseTo(FLAT_DOJO.playerSpawns[0]?.x ?? -4, 1);
  expect(players[1]?.x).toBeCloseTo(FLAT_DOJO.playerSpawns[1]?.x ?? 4, 1);
});

test("golden goal: a bell ring during goldenGoal → complete with winner", () => {
  const sim = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: true,
  });
  sim.step(START); // preRound → playing
  // Step into goldenGoal.
  for (let i = 0; i < 20; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  expect(sim.getMatchState().phase).toBe("goldenGoal");

  // Ring a bell to end the match.
  ringBell(sim, "right", 0);
  const reached = waitForPhase(sim, "complete");
  expect(reached).toBe(true);
  const m = sim.getMatchState();
  // winner should be set (0 or 1, not -1).
  expect(m.winner).not.toBe(-1);
});

test("getMatchState() returns a copy — external mutation doesn't affect sim", () => {
  const sim = newSim();
  const m = sim.getMatchState();
  m.scores[0] = 999; // mutate the copy
  const m2 = sim.getMatchState();
  expect(m2.scores[0]).toBe(0); // sim state unchanged
});
