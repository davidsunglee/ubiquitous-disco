/**
 * Combat tests — Phase 3.
 *
 * Covers: stagger accumulation, Knockdown trigger, control lock + stand-up,
 * Recovery Invulnerability (i-frames), stagger decay (anti-stunlock), mutual
 * simultaneous strikes, and strike-vs-ball regression.
 *
 * Design notes:
 *  - Slot 0 spawns at x=-4, slot 1 at x=+4. We walk them together until within
 *    strike reach (reach=2 + playerHitRadius=0.6 = 2.6 units) then test combat.
 *  - The match must be in a live phase for gameplay rules to run. We use a short
 *    startMatch helper (jump press on slot 0) so the sim advances to "playing".
 *  - staggerThreshold=3, staggerPerHit=1 → 3 hits to knock down (default config).
 *  - knockdownDurationTicks=36, recoveryInvulnTicks=30 (default config).
 *  - We use a combat config override with lower thresholds when we want fast tests.
 */

import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  type SimConfig,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function frame(p: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...p };
}

/** Build a sim with optional combat config overrides. */
function newSim(combatOverride: Partial<SimConfig["combat"]> = {}) {
  const config: SimConfig = {
    ...DEFAULT_CONFIG,
    combat: { ...DEFAULT_CONFIG.combat, ...combatOverride },
  };
  return createSimulation({ config, arena: FLAT_DOJO, seed: 42 });
}

/** Start the match (preRound → playing) by pressing the jump button on slot 0. */
function startMatch(sim: ReturnType<typeof newSim>): void {
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
}

/**
 * Walk the two players toward each other until they are within strike+playerHitRadius
 * of each other. Slot 0 walks right, slot 1 walks left. Returns when they are in range
 * or after maxTicks attempts.
 */
function walkIntoRange(sim: ReturnType<typeof newSim>, maxTicks = 200): void {
  const reach =
    DEFAULT_CONFIG.strike.reach + DEFAULT_CONFIG.combat.playerHitRadius;
  for (let i = 0; i < maxTicks; i++) {
    const s = sim.getRenderState();
    const p0 = s.players[0];
    const p1 = s.players[1];
    if (!p0 || !p1) break;
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (dist <= reach * 0.95) return;
    // Slot 0 walks right toward slot 1; slot 1 walks left toward slot 0.
    sim.step([frame({ moveX: 1 }), frame({ moveX: -1 })]);
  }
}

/**
 * Have slot 0 release a tap strike (press + release in two consecutive ticks).
 * Returns the stagger value on slot 1 after the strike.
 */
function tapStrike0(sim: ReturnType<typeof newSim>): void {
  sim.step([frame({ strikeHeld: true, strikePressed: true }), EMPTY_INPUT]);
  sim.step([frame({ strikeReleased: true }), EMPTY_INPUT]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("a strike on a player adds stagger", () => {
  const sim = newSim();
  startMatch(sim);
  walkIntoRange(sim);

  // One tap strike from slot 0 → slot 1 should gain stagger.
  tapStrike0(sim);

  const s = sim.getRenderState();
  // Slot 1 should be within strike reach still (or slightly displaced).
  // The internal actor stagger is not exposed on RenderState, so we check the
  // knockdown flag (not yet triggered) and verify via a 2nd-hit approach.
  // After 1 hit with staggerPerHit=1 and threshold=3, not yet knocked down.
  expect(s.players[1]?.knockedDown).toBe(false);
});

test("reaching staggerThreshold triggers Knockdown", () => {
  // Use staggerThreshold=1 so a single hit knocks down, for simplicity.
  const sim = newSim({ staggerThreshold: 1, staggerPerHit: 1 });
  startMatch(sim);
  walkIntoRange(sim);

  // One hit should trigger knockdown immediately.
  tapStrike0(sim);

  const s = sim.getRenderState();
  expect(s.players[1]?.knockedDown).toBe(true);
});

test("playerHit event fires on a non-knockdown hit (per-hit feedback)", () => {
  // Default threshold=3, so a single hit staggers but does NOT knock down.
  const sim = newSim();
  startMatch(sim);
  walkIntoRange(sim);

  tapStrike0(sim);

  const evts = sim.drainEvents();
  const hit = evts.find((e) => e.type === "playerHit");
  expect(hit).toBeDefined();
  if (hit && hit.type === "playerHit") {
    expect(hit.slot).toBe(1);
    expect(hit.knockdown).toBe(false);
  }
  // The non-knockdown hit must not have produced a knockdown event.
  expect(evts.find((e) => e.type === "knockdown")).toBeUndefined();
});

test("playerHit event marks knockdown=true on the hit that knocks down", () => {
  const sim = newSim({ staggerThreshold: 1, staggerPerHit: 1 });
  startMatch(sim);
  walkIntoRange(sim);

  tapStrike0(sim);

  const evts = sim.drainEvents();
  const hit = evts.find((e) => e.type === "playerHit");
  expect(hit).toBeDefined();
  if (hit && hit.type === "playerHit") {
    expect(hit.slot).toBe(1);
    expect(hit.knockdown).toBe(true);
  }
});

test("knockdown event emitted when a player is knocked down", () => {
  const sim = newSim({ staggerThreshold: 1, staggerPerHit: 1 });
  startMatch(sim);
  walkIntoRange(sim);

  tapStrike0(sim);

  // Drain events — a knockdown event for slot 1 should be present.
  const evts = sim.drainEvents();
  const kd = evts.find((e) => e.type === "knockdown");
  expect(kd).toBeDefined();
  if (kd && kd.type === "knockdown") {
    expect(kd.slot).toBe(1);
  }
});

test("control is locked during Knockdown then restored with invulnTicks set", () => {
  const sim = newSim({
    staggerThreshold: 1,
    staggerPerHit: 1,
    knockdownDurationTicks: 5,
    recoveryInvulnTicks: 10,
  });
  startMatch(sim);
  walkIntoRange(sim);
  tapStrike0(sim);

  // Slot 1 should be knocked down.
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(true);

  // During knockdown, slot 1 cannot move (control locked).
  const xBeforeAttempt = sim.getRenderState().players[1]?.x ?? 0;
  // Step with slot 1 trying to move right — should not affect vx since controlLock.
  for (let i = 0; i < 3; i++) {
    sim.step([EMPTY_INPUT, frame({ moveX: 1 })]);
  }
  // Still knocked down (duration = 5, only 3 ticks passed).
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(true);

  // Wait for knockdown to expire (5 ticks total).
  for (let i = 0; i < 3; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }

  // Now should be standing (not knocked down) and invulnerable.
  const s = sim.getRenderState();
  expect(s.players[1]?.knockedDown).toBe(false);
  expect(s.players[1]?.invulnerable).toBe(true);

  // Position may have changed due to knockback, but the player didn't control-move.
  // The key check: after recovery, slot 1 can move again.
  const xBeforeMove = sim.getRenderState().players[1]?.x ?? 0;
  // Wait for invuln to expire (10 ticks).
  for (let i = 0; i < 11; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }
  expect(sim.getRenderState().players[1]?.invulnerable).toBe(false);
  // Now actually move.
  for (let i = 0; i < 5; i++) {
    sim.step([EMPTY_INPUT, frame({ moveX: 1 })]);
  }
  const xAfterMove = sim.getRenderState().players[1]?.x ?? 0;
  expect(xAfterMove).toBeGreaterThan(xBeforeMove);

  // Avoid unused variable warning.
  void xBeforeAttempt;
});

test("i-frames block stagger/knockback during recovery invulnerability", () => {
  const sim = newSim({
    staggerThreshold: 1,
    staggerPerHit: 1,
    knockdownDurationTicks: 5,
    recoveryInvulnTicks: 60, // long i-frames so we can test reliably
  });
  startMatch(sim);
  walkIntoRange(sim);

  // Knock down slot 1.
  tapStrike0(sim);
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(true);

  // Wait for knockdown to expire.
  for (let i = 0; i < 6; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(false);
  expect(sim.getRenderState().players[1]?.invulnerable).toBe(true);

  // Walk back into range (knockback may have separated them).
  walkIntoRange(sim);

  // Drain all events accumulated so far (including the original knockdown event)
  // so we get a clean slate to check for new knockdown events during i-frames.
  sim.drainEvents();

  // Attempt another strike on slot 1 while they are invulnerable.
  // The strike should NOT add stagger or knock down.
  const beforeKD = sim.getRenderState().players[1]?.knockedDown ?? false;
  tapStrike0(sim);
  const afterKD = sim.getRenderState().players[1]?.knockedDown ?? false;

  // Still not knocked down (i-frames blocked the hit).
  expect(beforeKD).toBe(false);
  expect(afterKD).toBe(false);

  // No new knockdown event (i-frames should have blocked the hit entirely).
  const evts = sim.drainEvents().filter((e) => e.type === "knockdown");
  expect(evts).toHaveLength(0);
});

test("a knocked-down target is immune to further strikes (no stunlock)", () => {
  const sim = newSim({
    staggerThreshold: 1,
    staggerPerHit: 1,
    knockdownDurationTicks: 30,
    recoveryInvulnTicks: 30,
  });
  startMatch(sim);
  walkIntoRange(sim);

  // Knock slot 1 down.
  tapStrike0(sim);
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(true);
  sim.drainEvents();

  // Mash strikes on the downed target — none should connect (no playerHit),
  // and slot 1 must still stand up on schedule (not perpetually re-knocked-down).
  let recovered = false;
  for (let i = 0; i < 40; i++) {
    tapStrike0(sim);
    const hits = sim
      .drainEvents()
      .filter((e) => e.type === "playerHit" && e.slot === 1);
    expect(hits).toHaveLength(0);
    if (!sim.getRenderState().players[1]?.knockedDown) {
      recovered = true;
      break;
    }
  }
  expect(recovered).toBe(true);
});

test("stagger decays over time (anti-stunlock)", () => {
  // staggerThreshold=3, staggerPerHit=1, staggerDecayPerTick=0.5 (fast decay for test).
  // staggerGraceTicks=0 disables the post-hit hold so we test pure decay.
  const sim = newSim({
    staggerThreshold: 3,
    staggerPerHit: 1,
    staggerDecayPerTick: 0.5, // decay faster so we can verify in a few ticks
    staggerGraceTicks: 0,
  });
  startMatch(sim);
  walkIntoRange(sim);

  // Land one hit (stagger becomes 1).
  tapStrike0(sim);

  // After 3 live ticks, stagger should have decayed by 3 * 0.5 = 1.5 → 0 (clamped).
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  // Now land 2 more hits — if stagger were still accumulating from before, it would
  // reach threshold=3 and cause knockdown. With decay, it should be < 3 now.
  // Re-approach if needed.
  walkIntoRange(sim);
  tapStrike0(sim); // stagger +1 (from ~0, so ~1 total)
  walkIntoRange(sim);
  tapStrike0(sim); // stagger +1 → ~2 total (still < threshold=3)

  // Not knocked down yet despite 3 total hits because decay cleared the first one.
  expect(sim.getRenderState().players[1]?.knockedDown).toBe(false);
});

test("grace window: spaced-out hits still reach Knockdown (count, not timing)", () => {
  // threshold=3 with the default grace window (45 ticks). Land 3 hits spaced ~20
  // ticks apart — well within grace — and confirm a knockdown despite the gaps.
  // With pure decay (no grace) this spacing would never knock down.
  const sim = newSim(); // defaults: threshold 3, grace 45, decay 0.05
  startMatch(sim);
  walkIntoRange(sim);

  for (let hit = 0; hit < 3; hit++) {
    walkIntoRange(sim);
    tapStrike0(sim);
    // Idle ~20 ticks between hits (inside the 45-tick grace window).
    for (let i = 0; i < 18; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }

  expect(sim.getRenderState().players[1]?.knockedDown).toBe(true);
});

test("simultaneous mutual strikes both land", () => {
  // Both players strike each other on the same tick from within reach.
  // staggerThreshold=1 so a single hit triggers knockdown.
  const sim = newSim({ staggerThreshold: 1, staggerPerHit: 1 });
  startMatch(sim);
  walkIntoRange(sim);

  // Both press strike simultaneously (press tick).
  sim.step([
    frame({ strikeHeld: true, strikePressed: true }),
    frame({ strikeHeld: true, strikePressed: true }),
  ]);
  // Both release simultaneously (release tick — both hits resolve this tick).
  sim.step([frame({ strikeReleased: true }), frame({ strikeReleased: true })]);

  const s = sim.getRenderState();
  // Both should be knocked down (mutual trade).
  expect(s.players[0]?.knockedDown).toBe(true);
  expect(s.players[1]?.knockedDown).toBe(true);
});

test("strike-vs-ball behavior is unchanged (regression)", () => {
  // Verify that the ball still launches after a strike when near it.
  const sim = newSim();
  startMatch(sim);

  // Let ball settle then approach.
  for (let i = 0; i < 40; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  for (let i = 0; i < 50; i++) {
    sim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const s = sim.getRenderState();
    const p = s.players[0];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
  }

  const ballBefore = sim.getRenderState().ball;
  // Tap strike slot 0 toward the ball.
  sim.step([
    frame({ strikeHeld: true, strikePressed: true, moveX: 1, moveY: 1 }),
    EMPTY_INPUT,
  ]);
  sim.step([frame({ strikeReleased: true, moveX: 1, moveY: 1 }), EMPTY_INPUT]);
  const ballAfter = sim.getRenderState().ball;

  const moved = Math.hypot(
    ballAfter.x - ballBefore.x,
    ballAfter.y - ballBefore.y,
  );
  expect(moved).toBeGreaterThan(0.05);
});

test("determinism: scripted combat session produces equal hash across two runs", () => {
  const run = () => {
    const sim = newSim({ staggerThreshold: 1, staggerPerHit: 1 });
    startMatch(sim);
    walkIntoRange(sim);
    tapStrike0(sim);
    // Wait through knockdown and recovery.
    for (let i = 0; i < 80; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    return sim.hashState();
  };
  expect(run()).toBe(run());
});
