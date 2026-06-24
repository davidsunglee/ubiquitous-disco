/**
 * Practice Bot controller tests.
 *
 * Verifies:
 *  1. Determinism: same (slotId, view, config) always produces the identical InputFrame.
 *  2. Behaviour: bot moves toward the ball, strikes when in reach + facing the target
 *     bell, retreats when the ball is heading dangerously toward the own bell, and
 *     emits a jump when the ball is high.
 *
 * These tests run against the pure `samplePracticeBotInput` function only — no Rapier,
 * no simulation, no async setup required.
 */

import { expect, test } from "vitest";
import { type BotWorldView, samplePracticeBotInput } from "../bot/practiceBot";
import { DEFAULT_CONFIG } from "../config";
import { EMPTY_INPUT } from "../input";

// ── Determinism ────────────────────────────────────────────────────────────────

test("bot input is deterministic for a fixed view", () => {
  const view: BotWorldView = {
    tick: 10,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 1, vx: 0, vy: 0 },
  };
  const a = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  const b = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(a).toEqual(b);
});

test("bot input is deterministic across multiple slots with the same view", () => {
  const view: BotWorldView = {
    tick: 42,
    self: { x: -3, y: 1, facing: 1, grounded: true },
    ball: { x: 0, y: 2, vx: 0, vy: 0 },
  };
  // Each slot may produce different output (team differs), but each call is stable.
  for (const slotId of [0, 1, 2, 3] as const) {
    const r1 = samplePracticeBotInput(slotId, view, DEFAULT_CONFIG);
    const r2 = samplePracticeBotInput(slotId, view, DEFAULT_CONFIG);
    expect(r1).toEqual(r2);
  }
});

// ── Ball-chase behaviour ───────────────────────────────────────────────────────

test("slot-0 bot chases ball to its right (moveX = 1)", () => {
  const view: BotWorldView = {
    tick: 10,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 1, vx: 0, vy: 0 }, // ball is to the right of bot
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(Math.sign(frame.moveX)).toBe(1);
});

test("slot-0 bot chases ball to its left (moveX = -1)", () => {
  const view: BotWorldView = {
    tick: 10,
    self: { x: 2, y: 1, facing: 1, grounded: true },
    ball: { x: -1, y: 1, vx: 0, vy: 0 }, // ball is to the left of bot
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(Math.sign(frame.moveX)).toBe(-1);
});

test("slot-2 bot (Team 1) chases ball to its left (moveX = -1)", () => {
  const view: BotWorldView = {
    tick: 5,
    self: { x: 6, y: 1, facing: -1, grounded: true },
    ball: { x: 2, y: 1, vx: 0, vy: 0 }, // ball is to the left of bot
  };
  const frame = samplePracticeBotInput(2, view, DEFAULT_CONFIG);
  expect(Math.sign(frame.moveX)).toBe(-1);
});

// ── Strike behaviour ───────────────────────────────────────────────────────────

test("bot strikes when ball is in reach and facing toward opposing bell", () => {
  // Slot 0: Team 0, opposing bell is on the right (x=9). Ball directly adjacent.
  const view: BotWorldView = {
    tick: 5,
    self: { x: -0.5, y: 1, facing: 1, grounded: true },
    ball: { x: 1, y: 1, vx: 0, vy: 0 }, // within strike reach (reach=2)
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  // Should be chasing ball (right) and in reach → strike
  expect(frame.strikeHeld).toBe(true);
  expect(frame.strikePressed).toBe(true);
});

test("bot does NOT strike when ball is out of reach", () => {
  const view: BotWorldView = {
    tick: 5,
    self: { x: -4, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 1, vx: 0, vy: 0 }, // distance = 7, reach = 2
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(frame.strikeHeld).toBe(false);
});

// ── Jump behaviour ────────────────────────────────────────────────────────────

test("bot jumps for a high ball when grounded", () => {
  const view: BotWorldView = {
    tick: 5,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 1, y: 4, vx: 0, vy: 0 }, // ball is 3 units above, out of reach vertically but close horizontally
  };
  // Ball y - self y = 3 > 0.8 threshold, and not in reach (distance > reach)
  const dist = Math.hypot(1 - 0, 4 - 1); // ~3.16 > reach
  expect(dist).toBeGreaterThan(DEFAULT_CONFIG.strike.reach);

  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(frame.jumpHeld).toBe(true);
  expect(frame.jumpPressed).toBe(true);
});

test("bot does NOT jump when ball is at same height", () => {
  const view: BotWorldView = {
    tick: 5,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 4, y: 1.5, vx: 0, vy: 0 }, // y diff = 0.5 < 0.8 threshold
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(frame.jumpHeld).toBe(false);
});

test("bot jumps for a moderately-high floaty ball (threshold lowered to 0.8)", () => {
  // FLI-11: the jump threshold was lowered from 1.5 → 0.8 so the bot contests
  // the air earlier against floaty balls. A yDiff of 1.0 now triggers a jump
  // (1.0 > 0.8) where it previously would not have (1.0 < 1.5).
  // Ball at x=3, y=2 → yDiff = 1.0 > 0.8; dist = hypot(3,1) ≈ 3.16 > reach 2.55 (out of reach).
  const view: BotWorldView = {
    tick: 5,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 2.0, vx: 0, vy: 0 }, // yDiff 1.0 > 0.8, out of reach
  };
  const dist = Math.hypot(3 - 0, 2.0 - 1);
  expect(dist).toBeGreaterThan(DEFAULT_CONFIG.strike.reach);
  const f = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(f.jumpPressed).toBe(true);
});

// ── Retreat behaviour ─────────────────────────────────────────────────────────

test("bot retreats toward own bell when ball is heading dangerously toward it", () => {
  // Team 0 (slot 0): own bell is at x=-9. Ball moving left fast, on the left side.
  const view: BotWorldView = {
    tick: 5,
    self: { x: -3, y: 1, facing: 1, grounded: true },
    ball: { x: -2, y: 1, vx: -5, vy: 0 }, // fast leftward, already left of centre → dangerous
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  // Bot should retreat left toward own bell at x=-9 (moveX = -1)
  expect(Math.sign(frame.moveX)).toBe(-1);
  // And should NOT strike while retreating
  expect(frame.strikeHeld).toBe(false);
});

test("slot-2 bot (Team 1) retreats rightward when ball is heading toward its bell", () => {
  // Team 1 (slot 2): own bell is at x=9. Ball moving right fast, on the right side.
  const view: BotWorldView = {
    tick: 5,
    self: { x: 3, y: 1, facing: -1, grounded: true },
    ball: { x: 2, y: 1, vx: 5, vy: 0 }, // fast rightward, already right of centre → dangerous
  };
  const frame = samplePracticeBotInput(2, view, DEFAULT_CONFIG);
  // Bot should retreat right toward own bell at x=9 (moveX = 1)
  expect(Math.sign(frame.moveX)).toBe(1);
  expect(frame.strikeHeld).toBe(false);
});

// ── Corner / wall-escape behaviour ────────────────────────────────────────────
// Side walls' inner faces are at x = ±11.5; both Bells are at x = ±9 (inside the
// walls). A bot pressed into a wall must not grind into it forever — it should
// head back toward open play and clear an in-reach ball out of the corner.

test("slot-0 bot pinned against its own (left) wall strikes to clear, not grind", () => {
  // Bot pressed to the left wall; ball is in reach but between the bot and the
  // wall (to the bot's left). Naively chasing it would push moveX into the wall
  // and never strike (facing away from the target bell).
  const view: BotWorldView = {
    tick: 7,
    self: { x: -11, y: 1, facing: -1, grounded: true },
    ball: { x: -11.5, y: 1, vx: 0, vy: 0 }, // in reach, toward the wall
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  // Clears the ball out of the corner toward open play (away from the wall).
  expect(frame.strikeHeld).toBe(true);
  expect(Math.sign(frame.moveX)).toBe(1);
});

test("slot-0 bot cornered with an out-of-reach ball heads away from the wall", () => {
  // Ball is toward the wall but too far to strike; the bot must move back toward
  // open play (moveX = +1), not grind into the wall (moveX = -1).
  const view: BotWorldView = {
    tick: 3,
    self: { x: -10.5, y: 1, facing: -1, grounded: true },
    ball: { x: -11.5, y: 4, vx: 0, vy: 0 }, // dist ≈ 3.16 > reach, toward wall
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(Math.sign(frame.moveX)).toBe(1);
});

test("slot-2 bot (Team 1) pinned against its own (right) wall strikes to clear", () => {
  const view: BotWorldView = {
    tick: 9,
    self: { x: 10.5, y: 1, facing: 1, grounded: true },
    ball: { x: 11.3, y: 1, vx: 0, vy: 0 }, // in reach, toward the right wall
  };
  const frame = samplePracticeBotInput(2, view, DEFAULT_CONFIG);
  expect(frame.strikeHeld).toBe(true);
  expect(Math.sign(frame.moveX)).toBe(-1);
});

// ── Output is always a complete InputFrame ────────────────────────────────────

test("bot output always returns a complete InputFrame (no missing fields)", () => {
  const view: BotWorldView = {
    tick: 1,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 0, y: 1, vx: 0, vy: 0 },
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  // Every field from EMPTY_INPUT must be present in the bot output.
  for (const key of Object.keys(EMPTY_INPUT) as (keyof typeof EMPTY_INPUT)[]) {
    expect(frame).toHaveProperty(key);
  }
});

// ── Phase 1 (FLI-9): per-actor resolved stats ─────────────────────────────────

test("bot uses passed stats.strikeReach — high-reach character strikes from farther than Sifu", () => {
  // Default Sifu reach = 2; Old Master reach multiplier 1.2 → resolved reach = 2.4.
  const highReachStats = { strikeReach: 2.4, dashDistance: 3 };
  const sifuStats = { strikeReach: 2, dashDistance: 3 };

  // Ball at distance 2.2 from bot — in reach for Old Master, out for Sifu.
  const view: BotWorldView = {
    tick: 5,
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 2.2, y: 1, vx: 0, vy: 0 }, // distance = 2.2
  };

  const highReachFrame = samplePracticeBotInput(
    0,
    view,
    DEFAULT_CONFIG,
    highReachStats,
  );
  const sifuFrame = samplePracticeBotInput(0, view, DEFAULT_CONFIG, sifuStats);

  // Old Master (high reach) should want to strike; Sifu should not.
  expect(highReachFrame.strikeHeld).toBe(true);
  expect(sifuFrame.strikeHeld).toBe(false);
});

test("bot uses passed stats.dashDistance — low-dash character dashes at shorter distance", () => {
  // FLI-11: dash.distance base = 2.4. Panda multiplier 0.85 → resolved 2.04.
  // Sifu multiplier 1.0 → resolved 2.4. These tests pass explicit stats so the
  // values are scenario fixtures chosen to show the per-character distinction.
  const lowDashStats = { strikeReach: 2, dashDistance: 2.55 };
  const sifuStats = { strikeReach: 2, dashDistance: 3 };

  // Ball at distance 2.8: beyond Panda's dash distance (2.55) but within Sifu's (3).
  // Not a strike (out of reach). Not Sifu's dash threshold either (> 3 needed).
  // Ball at distance 2.0: within both dash distances — both won't dash.
  // So test with distance 2.7 (< sifu dash 3, > panda dash 2.55, not in reach).
  const view: BotWorldView = {
    tick: 18, // tick % 18 === 0 so dash condition fires
    self: { x: 0, y: 1, facing: 1, grounded: true },
    ball: { x: 2.7, y: 1, vx: 0, vy: 0 }, // distance = 2.7
  };

  const lowDashFrame = samplePracticeBotInput(
    0,
    view,
    DEFAULT_CONFIG,
    lowDashStats,
  );
  const sifuFrame = samplePracticeBotInput(0, view, DEFAULT_CONFIG, sifuStats);

  // Sifu: distance 2.7 < dash.distance 3 → won't dash (wantDash = false).
  // Panda: distance 2.7 > panda dash 2.55 → will dash.
  expect(lowDashFrame.dashPressed).toBe(true);
  expect(sifuFrame.dashPressed).toBe(false);
});

test("bot defaults to config stats when no stats arg given (backward compat)", () => {
  const view: BotWorldView = {
    tick: 5,
    self: { x: -0.5, y: 1, facing: 1, grounded: true },
    ball: { x: 1, y: 1, vx: 0, vy: 0 }, // within strike reach (reach=2)
  };
  // Without stats arg — should behave same as with DEFAULT_CONFIG stats.
  const frameDefault = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  const frameExplicit = samplePracticeBotInput(0, view, DEFAULT_CONFIG, {
    strikeReach: DEFAULT_CONFIG.strike.reach,
    dashDistance: DEFAULT_CONFIG.dash.distance,
  });
  expect(frameDefault).toEqual(frameExplicit);
});

// ── Phase 4 (FLI-12): bay ramp-and-pocket defense ────────────────────────────
// Temple Ascent has bayRampBaseX: { left: -30, right: 30 }. The server threads
// the own-side base x per slot. These tests exercise the pure bot function with
// an explicit bayRampBaseX to verify the bay-defense branch.

const TEMPLE_ARENA = {
  leftBellX: -43,
  rightBellX: 43,
  wallInnerX: 45.5,
  bayRampBaseX: -30, // Team 0 own side (left bay)
} as const;

test("Team-0 bot with ball deep in left bay moves toward own Bell (ascends ramp)", () => {
  // Ball is past the ramp base x (|ball.x| >= |bayRampBaseX|) on the own side.
  // The bot should move toward ownBellX (-43) rather than a flat stop.
  const view: BotWorldView = {
    tick: 5,
    self: { x: -20, y: 1, facing: -1, grounded: true },
    ball: { x: -35, y: 2, vx: 0, vy: 0 }, // |−35| ≥ |−30| → in left bay
    arena: TEMPLE_ARENA,
  };
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  // Bot should ascend toward own Bell (moveX < 0 = toward left)
  expect(Math.sign(frame.moveX)).toBe(-1);
});

test("Team-0 bot with high ball in own bay jumps to contest under the eave", () => {
  // Ball is in the own bay AND above HIGH_BALL_JUMP_DY from self — bot should jump.
  const HIGH_BALL_JUMP_DY = 0.8;
  const view: BotWorldView = {
    tick: 5,
    self: { x: -35, y: 4, facing: -1, grounded: true },
    ball: { x: -40, y: 4 + HIGH_BALL_JUMP_DY + 0.5, vx: 0, vy: 0 }, // high in bay
    arena: TEMPLE_ARENA,
  };
  // Verify ball is in bay: |ball.x|=40 >= |bayRampBaseX|=30, sign matches team-0 (left)
  const dist = Math.hypot(view.ball.x - view.self.x, view.ball.y - view.self.y);
  expect(dist).toBeGreaterThan(DEFAULT_CONFIG.strike.reach); // out of reach so no strike
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(frame.jumpPressed).toBe(true);
});

test("Team-0 bot in own bay strikes toward center even when ball is dangerous", () => {
  // In-bay + in reach: a strike away from the Bell is the defensive clear.
  // Even though ballDangerous is true (ball moving fast left, already left of center),
  // the bot should still strike because inOwnBay overrides ballDangerous.
  const view: BotWorldView = {
    tick: 5,
    // Bot is near the bell, ball is in reach
    self: { x: -41, y: 4, facing: 1, grounded: true }, // facing right (toward center)
    ball: { x: -40, y: 4, vx: -5, vy: 0 }, // dangerous: moving left, left of center
    arena: TEMPLE_ARENA,
  };
  // Confirm ball is in reach
  const dist = Math.hypot(view.ball.x - view.self.x, view.ball.y - view.self.y);
  expect(dist).toBeLessThanOrEqual(DEFAULT_CONFIG.strike.reach);
  const frame = samplePracticeBotInput(0, view, DEFAULT_CONFIG);
  expect(frame.strikeHeld).toBe(true);
});

test("open-center: no bayRampBaseX → behavior unchanged (chase ball normally)", () => {
  // When arena has no bayRampBaseX (Flat Dojo / Twin Ledge / legacy), the bot
  // should behave exactly as before: just chase the ball.
  const viewWithBay: BotWorldView = {
    tick: 5,
    self: { x: -5, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 1, vx: 0, vy: 0 },
    arena: { leftBellX: -9, rightBellX: 9, wallInnerX: 11.5 }, // no bayRampBaseX
  };
  const viewNoBay: BotWorldView = {
    tick: 5,
    self: { x: -5, y: 1, facing: 1, grounded: true },
    ball: { x: 3, y: 1, vx: 0, vy: 0 },
    // explicitly absent
  };
  const frameWithBay = samplePracticeBotInput(0, viewWithBay, DEFAULT_CONFIG);
  const frameNoBay = samplePracticeBotInput(0, viewNoBay, DEFAULT_CONFIG);
  // Both should chase the ball to the right
  expect(Math.sign(frameWithBay.moveX)).toBe(1);
  expect(Math.sign(frameNoBay.moveX)).toBe(1);
  // Strike behavior also unchanged (ball on right side, facing right = facing target bell)
  expect(frameWithBay.strikeHeld).toEqual(frameNoBay.strikeHeld);
});
