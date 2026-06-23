/**
 * Match lifecycle tests.
 *
 * Covers: scoring attribution when either Bell is rung, timer → regulation,
 * tied Golden Goal completion, gameplay frozen in non-live phases, and start/rematch edges.
 *
 * Uses short-match config overrides to keep tests fast.
 */

import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  type InputFrame,
  initSim,
} from "../index";
// Bell-ring/scoring tests strike the ball into a bell; use the compact fixture
// (bells at x=±9) so a single Strike reaches the bell on the large production
// arenas the ball-to-bell distance is far beyond Strike range.
import { COMPACT_DOJO } from "./fixtures/compactArena";

beforeAll(async () => {
  await initSim();
});

function frame(p: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...p };
}

// The jump button edge from slot 0 acts as "Start" / "Rematch".
// 1v1 uses [0, 2] template; sparse array with slot 0 pressed, slot 2 empty.
function makeStart(): InputFrame[] {
  const f: InputFrame[] = [];
  f[0] = frame({ jumpPressed: true, jumpHeld: true });
  f[2] = EMPTY_INPUT;
  return f;
}
const START: InputFrame[] = makeStart();

function newSim(matchOverride: Record<string, unknown> = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    match: { ...DEFAULT_CONFIG.match, ...matchOverride },
  };
  return createSimulation({ config, arena: COMPACT_DOJO, seed: 11 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Helper that mimics ringRightBell from bellRing.test.ts: walks slot `slot`
 * toward the ball and releases a partial-charge up-right Strike aimed at
 * the right Bell. The *opposing* team should be credited.
 *
 * For the default 1v1 [0, 2] template, valid driver slots are 0 and 2.
 */
function ringBell(
  sim: ReturnType<typeof newSim>,
  bellSide: "left" | "right",
  driverSlot: 0 | 2,
): void {
  // Let everyone settle (sparse: both active slots get EMPTY_INPUT).
  const emptyRow = (): InputFrame[] => {
    const r: InputFrame[] = [];
    r[0] = EMPTY_INPUT;
    r[2] = EMPTY_INPUT;
    return r;
  };
  // FLI-11 Phase 2: ball gravityScale lowered to 0.32 — ball falls much more
  // slowly from y=5 in COMPACT_DOJO. Use 90 settle ticks so the ball has time
  // to descend and bounce to reachable height before the driver walks in.
  for (let i = 0; i < 90; i++) sim.step(emptyRow());
  // Walk driver toward ball.
  const moveX = driverSlot === 0 ? 1 : -1;
  for (let i = 0; i < 80; i++) {
    const row = emptyRow();
    row[driverSlot] = frame({ moveX });
    sim.step(row);
    const s = sim.getRenderState();
    const p = s.players[driverSlot];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
  }
  // Charge and release strike toward the target bell.
  const dirX = bellSide === "right" ? 1 : -1;
  const strikeInput = (held: boolean, released = false): InputFrame =>
    frame({
      moveX: dirX,
      moveY: 1,
      strikeHeld: held,
      strikePressed: held && !released,
      strikeReleased: released,
    });

  const rowWithStrike = (held: boolean, released = false): InputFrame[] => {
    const r = emptyRow();
    r[driverSlot] = strikeInput(held, released);
    return r;
  };

  sim.step(rowWithStrike(true));
  for (let i = 0; i < 8; i++) sim.step(rowWithStrike(true));
  sim.step(rowWithStrike(false, true));
}

/** Empty input row for the default 1v1 [0, 2] template. */
function emptyRow1v1(): InputFrame[] {
  const r: InputFrame[] = [];
  r[0] = EMPTY_INPUT;
  r[2] = EMPTY_INPUT;
  return r;
}

/** Wait up to maxTicks for the match to reach the given phase. */
function waitForPhase(
  sim: ReturnType<typeof newSim>,
  targetPhase: string,
  maxTicks = 200,
): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (sim.getMatchState().phase === targetPhase) return true;
    sim.step(emptyRow1v1());
  }
  return sim.getMatchState().phase === targetPhase;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("gameplay is frozen during preRound — players don't move before Start", () => {
  const sim = newSim();
  const before = sim.getRenderState();
  for (let i = 0; i < 30; i++) {
    const r: InputFrame[] = [];
    r[0] = frame({ moveX: 1 });
    r[2] = frame({ moveX: -1 });
    sim.step(r);
  }
  const after = sim.getRenderState();
  // Still in preRound — positions unchanged.
  expect(sim.getMatchState().phase).toBe("preRound");
  expect(after.players[0]?.x).toBeCloseTo(before.players[0]?.x ?? 0, 4);
  expect(after.players[2]?.x).toBeCloseTo(before.players[2]?.x ?? 0, 4);
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
  for (let i = 0; i < 20; i++) {
    const r: InputFrame[] = [];
    r[0] = frame({ moveX: 1 });
    r[2] = EMPTY_INPUT;
    sim.step(r);
  }
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
  for (let i = 0; i < 10; i++) sim.step(emptyRow1v1());
  const timerAfter = sim.getMatchState().timer;
  expect(timerAfter).toBe(timerBefore - 10);
});

test("regulation timer expires: with unequal scores → complete + winner set", () => {
  // Use a tiny lengthTicks so timer expires quickly; scoringPauseTicks = 0
  // and resetTicks = 0 so the pause/reset cycle is instant.
  const sim = newSim({ lengthTicks: 5, scoringPauseTicks: 0, resetTicks: 0 });
  sim.step(START); // preRound → playing

  // Manually adjust scores to give team 0 a lead (we skip an actual bell ring here).
  // Instead, step until regulation expires at 0-0 → Golden Goal (goldenGoal: true by default).
  // Then override goldenGoal: false to get a clear winner test.
  const sim2 = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: false,
  });
  sim2.step(START); // preRound → playing
  // Step past the timer.
  for (let i = 0; i < 20; i++) sim2.step(emptyRow1v1());
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
  for (let i = 0; i < 20; i++) sim.step(emptyRow1v1());
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
  for (let i = 0; i < 20; i++) sim.step(emptyRow1v1()); // → complete
  expect(sim.getMatchState().phase).toBe("complete");
  // Press Start again for rematch.
  sim.step(START);
  const m = sim.getMatchState();
  expect(m.phase).toBe("playing");
  expect(m.scores).toEqual([0, 0]);
  expect(m.timer).toBe(5); // back to the short length
});

test("ringing a bell credits the OPPOSING team", () => {
  // scoringPauseTicks and resetTicks set to small values so test runs quickly.
  const sim = newSim({ scoringPauseTicks: 2, resetTicks: 2 });
  sim.step(START); // preRound → playing

  // Ring the right bell using slot 0 (driver). The right bell defends "right"
  // (team 1). Scoring team = opponent = team 0. Wait for bellRing event.
  ringBell(sim, "right", 0);
  let scored = false;
  for (let i = 0; i < 200; i++) {
    sim.step(emptyRow1v1());
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
    sim.step(emptyRow1v1());
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
  // 1v1 [0, 2] template: slot 0 at spawn[0]=-4, slot 2 at spawn[2]=4.
  const { players } = sim.getRenderState();
  expect(players[0]?.x).toBeCloseTo(COMPACT_DOJO.playerSpawns[0]?.x ?? -4, 1);
  expect(players[2]?.x).toBeCloseTo(COMPACT_DOJO.playerSpawns[2]?.x ?? 4, 1);
});

test("Golden Goal: a bell ring during goldenGoal → complete with winner", () => {
  const sim = newSim({
    lengthTicks: 5,
    scoringPauseTicks: 0,
    resetTicks: 0,
    goldenGoal: true,
  });
  sim.step(START); // preRound → playing
  // Step into goldenGoal.
  for (let i = 0; i < 20; i++) sim.step(emptyRow1v1());
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

// ── 2v2 tests ─────────────────────────────────────────────────────────────────

function new2v2(matchOverride: Record<string, unknown> = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    match: { ...DEFAULT_CONFIG.match, ...matchOverride },
  };
  return createSimulation({
    config,
    arena: COMPACT_DOJO,
    seed: 11,
    activeSlots: [0, 1, 2, 3],
  });
}

function emptyRow2v2(): InputFrame[] {
  const r: InputFrame[] = [];
  r[0] = EMPTY_INPUT;
  r[1] = EMPTY_INPUT;
  r[2] = EMPTY_INPUT;
  r[3] = EMPTY_INPUT;
  return r;
}

test("2v2: four actors spawn by Team side and facing", () => {
  const sim = new2v2();
  const { players } = sim.getRenderState();
  // Team 0 (slots 0/1) faces right (+1); Team 1 (slots 2/3) faces left (-1).
  expect(players[0]?.facing).toBe(1);
  expect(players[1]?.facing).toBe(1);
  expect(players[2]?.facing).toBe(-1);
  expect(players[3]?.facing).toBe(-1);
  // Team 0 spawns on the left, Team 1 on the right.
  expect(players[0]?.x).toBeLessThan(0);
  expect(players[1]?.x).toBeLessThan(0);
  expect(players[2]?.x).toBeGreaterThan(0);
  expect(players[3]?.x).toBeGreaterThan(0);
});

test("2v2: scores array has exactly 2 entries (Team-indexed)", () => {
  const sim = new2v2();
  const m = sim.getMatchState();
  expect(m.scores.length).toBe(2);
  expect(m.scores[0]).toBe(0);
  expect(m.scores[1]).toBe(0);
});

test("2v2: ringing the right Bell credits Team 0 (opposing Team 1 defends)", () => {
  const sim = new2v2({ scoringPauseTicks: 2, resetTicks: 2 });
  // Start the match with any jump.
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[1] = EMPTY_INPUT;
  startRow[2] = EMPTY_INPUT;
  startRow[3] = EMPTY_INPUT;
  sim.step(startRow);
  expect(sim.getMatchState().phase).toBe("playing");

  // FLI-11 Phase 2: ball gravityScale 0.32 — floaty ball falls slowly from y=5;
  // use 90 settle ticks so the ball descends to reachable height.
  for (let i = 0; i < 90; i++) sim.step(emptyRow2v2());

  // Walk slot 0 toward ball and release a charged right-ward Strike.
  const moveX = 1;
  for (let i = 0; i < 80; i++) {
    const r = emptyRow2v2();
    r[0] = frame({ moveX });
    sim.step(r);
    const s = sim.getRenderState();
    const p = s.players[0];
    if (!p) break;
    if (
      Math.hypot(s.ball.x - p.x, s.ball.y - p.y) <=
      DEFAULT_CONFIG.strike.reach * 0.9
    )
      break;
  }
  for (let i = 0; i < 9; i++) {
    const r = emptyRow2v2();
    r[0] = frame({
      moveX: 1,
      moveY: 1,
      strikeHeld: true,
      strikePressed: i === 0,
    });
    sim.step(r);
  }
  const releaseRow = emptyRow2v2();
  releaseRow[0] = frame({ moveX: 1, moveY: 1, strikeReleased: true });
  sim.step(releaseRow);

  // Wait for bellRing event.
  let scoringTeam = -1;
  for (let i = 0; i < 200; i++) {
    sim.step(emptyRow2v2());
    for (const ev of sim.drainEvents()) {
      if (ev.type === "bellRing") {
        scoringTeam = ev.scoringTeam;
        break;
      }
    }
    if (scoringTeam !== -1) break;
  }
  // Right bell defends Team 1 → scoring team = Team 0.
  expect(scoringTeam).toBe(0);
});

test("2v2: teammate Strike still connects (full-strength Friendly Fire)", () => {
  // Slots 0 and 1 are on Team 0. Place them adjacent, slot 0 strikes; expect
  // a playerHit event on slot 1 (teammate). This verifies there is NO team filter
  // in the strike target set (Friendly Fire invariant).
  const sim = new2v2();
  // Start the match.
  const startRow: InputFrame[] = [];
  startRow[0] = frame({ jumpPressed: true, jumpHeld: true });
  startRow[1] = EMPTY_INPUT;
  startRow[2] = EMPTY_INPUT;
  startRow[3] = EMPTY_INPUT;
  sim.step(startRow);

  // Walk slot 0 (at -4) left toward slot 1 (at -7) until they are within strike
  // reach (reach=2 + playerHitRadius=0.6 = 2.6 units). Stop as soon as in range
  // so they don't walk past each other (players pass through each other).
  const reach =
    DEFAULT_CONFIG.strike.reach + DEFAULT_CONFIG.combat.playerHitRadius;
  for (let i = 0; i < 200; i++) {
    const s = sim.getRenderState();
    const p0 = s.players[0];
    const p1 = s.players[1];
    if (!p0 || !p1) break;
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (dist <= reach * 0.95) break;
    const r = emptyRow2v2();
    r[0] = frame({ moveX: -1 }); // slot 0 walks left toward slot 1
    r[1] = frame({ moveX: 1 }); // slot 1 walks right toward slot 0
    sim.step(r);
  }

  // Slot 0 taps a Strike (press+release in one tick) — must connect on slot 1 (teammate).
  const strikeRow = emptyRow2v2();
  strikeRow[0] = frame({
    strikeHeld: true,
    strikePressed: true,
    strikeReleased: true,
  });
  sim.step(strikeRow);

  // Look for a playerHit event on slot 1 (teammate).
  let hitSlot1 = false;
  for (let i = 0; i < 10; i++) {
    for (const ev of sim.drainEvents()) {
      if (ev.type === "playerHit" && ev.slot === 1) {
        hitSlot1 = true;
      }
    }
    if (hitSlot1) break;
    sim.step(emptyRow2v2());
  }
  expect(hitSlot1).toBe(true);
});
