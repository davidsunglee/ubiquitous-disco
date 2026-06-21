/**
 * Lightweight-apply fidelity test (Phase 0, Spike 0b).
 *
 * Compares two methods of "restoring" a sim to a mid-session state, then
 * stepping forward N ticks and measuring how close the ball position is:
 *
 *   Baseline  (rapierBytes full restore):
 *     Run to T → takeSnapshot() → step forward → restoreSnapshot() → step forward → render_A
 *
 *   Candidate (lightweight pos/vel only):
 *     Run to T_candidate → capture {ball: {x,y,vx,vy}, players: [{x,y}]} from render state
 *     → create fresh sim → applyLightweightPositions() → step forward → render_B
 *
 * Reports the maximum ball positional drift (|Δx| + |Δy|) over the tail ticks
 * and asserts it stays within BALL_TOL.
 *
 * If the ball is unfaithful (drift > BALL_TOL), the Phase 0 "Decision lever"
 * fires: WorldSnapshot must carry rapierBytes, or adopt asymmetric reconciliation.
 * That decision is recorded in the Phase 0 Outcomes section.
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

/**
 * Acceptable maximum L1 ball-position drift between the full-restore baseline
 * and the lightweight pos/vel candidate for SHORT tails (≤ the reconciliation
 * replay window, typically 3-5 ticks).
 *
 * Over a short replay window the ball is usually in straight flight so drift is
 * near-zero. The divergence only appears when the ball bounces off a surface
 * (ceiling/wall) because the Rapier contact-solver warm-start impulses are not
 * part of the lightweight state. The SHORT_TAIL assertion validates the common
 * case; the LONG_TAIL run just measures and logs the divergence at wall contact.
 */
const BALL_TOL_SHORT = 0.01; // tolerance for the first SHORT_TAIL ticks (straight flight)

/** Short tail: ticks we expect to be faithful (typical reconciliation replay window). */
const SHORT_TAIL = 10;

/** Total measurement window: how many ticks to run after the fork point. */
const TAIL_TICKS = 90;

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

/**
 * Build a contact-heavy setup: start the match, let the ball fall and settle,
 * walk player 0 within reach of the ball, do a full-charge upward strike to
 * send it high (Bell-zone contact), then fork immediately after release.
 *
 * The "walk until within reach" approach mirrors bellRing.test.ts's ringRightBell()
 * to guarantee the strike connects. Ball settles near floor after falling from y=5.
 *
 * Returns { frames, forkTick, sim } — sim is stepped to forkTick so the caller
 * can read its state. The frames array contains exactly forkTick rows.
 */
function buildForkFrames(): {
  frames: InputFrame[][];
  forkTick: number;
  sim: ReturnType<typeof createSimulation>;
} {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });
  const frames: InputFrame[][] = [];

  function step(row: InputFrame[]): void {
    frames.push(row);
    sim.step(row);
  }

  // Start the match.
  step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

  // Let the ball fall and settle on the floor (~40 ticks is enough).
  for (let i = 0; i < 40; i++) step([EMPTY_INPUT, EMPTY_INPUT]);

  // Walk right until within strike reach of the (settled) ball.
  for (let i = 0; i < 50; i++) {
    const s = sim.getRenderState();
    const p = s.players[0];
    const b = s.ball;
    if (!p) break;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
    step([f({ moveX: 1 }), EMPTY_INPUT]);
  }

  // Full-charge upward strike (maxChargeTicks = 24; hold for 22 + release).
  step([
    f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 22; i++) {
    step([f({ moveX: 1, moveY: 1, strikeHeld: true }), EMPTY_INPUT]);
  }
  step([f({ moveX: 1, moveY: 1, strikeReleased: true }), EMPTY_INPUT]);

  // Fork immediately after strike release — ball is in fast upward flight.
  // Let it fly a couple of ticks to confirm it's actually moving.
  step([EMPTY_INPUT, EMPTY_INPUT]);
  step([EMPTY_INPUT, EMPTY_INPUT]);

  const forkTick = frames.length;

  return { frames, forkTick, sim };
}

test("lightweight apply vs rapierBytes restore: ball drift stays within tolerance", () => {
  const { frames: forkFrames, forkTick, sim: simAtFork } = buildForkFrames();

  const forkBallPos = simAtFork.getRenderState().ball;
  const forkBallVel = simAtFork.getBallVel();
  console.log(
    `[applyFidelity] Fork at tick ${forkTick}: ` +
      `ball pos=(${forkBallPos.x.toFixed(3)}, ${forkBallPos.y.toFixed(3)}) ` +
      `vel=(${forkBallVel.vx.toFixed(3)}, ${forkBallVel.vy.toFixed(3)})`,
  );

  // ── Baseline: full rapierBytes snapshot/restore ──────────────────────────
  // Replay the exact same frames independently to get a fresh baseline sim.
  const simBaseline = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });
  for (const row of forkFrames) simBaseline.step(row);
  const snapAtFork = simBaseline.takeSnapshot();

  // Step forward TAIL_TICKS to get reference renders.
  const baselineRenders: { x: number; y: number }[] = [];
  for (let i = 0; i < TAIL_TICKS; i++) {
    simBaseline.step([EMPTY_INPUT, EMPTY_INPUT]);
    baselineRenders.push(simBaseline.getRenderState().ball);
  }

  // Restore to fork point and re-step — this is the "full restore" candidate.
  simBaseline.restoreSnapshot(snapAtFork);
  const fullRestoreRenders: { x: number; y: number }[] = [];
  for (let i = 0; i < TAIL_TICKS; i++) {
    simBaseline.step([EMPTY_INPUT, EMPTY_INPUT]);
    fullRestoreRenders.push(simBaseline.getRenderState().ball);
  }

  // ── Candidate: lightweight pos/vel only apply ────────────────────────────
  // Capture the lightweight state from the sim that built the frames.
  const forkRender = simAtFork.getRenderState();
  const lightweightState = {
    players: forkRender.players.map((p) => ({ x: p.x, y: p.y })),
    ball: {
      x: forkRender.ball.x,
      y: forkRender.ball.y,
      vx: forkBallVel.vx,
      vy: forkBallVel.vy,
    },
  };

  // Create a fresh sim, advance it to "playing" phase (match must be live for
  // rw.step() to run), then apply the lightweight state. This mimics what a
  // client does when it receives a WorldSnapshot without rapierBytes.
  const simCandidate = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });
  // Transition to playing so physics run (isLivePhase must be true).
  simCandidate.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  // Now apply the captured lightweight state — this overwrites positions/vel.
  simCandidate.applyLightweightPositions(lightweightState);

  // Step forward TAIL_TICKS and capture renders.
  const candidateRenders: { x: number; y: number }[] = [];
  for (let i = 0; i < TAIL_TICKS; i++) {
    simCandidate.step([EMPTY_INPUT, EMPTY_INPUT]);
    candidateRenders.push(simCandidate.getRenderState().ball);
  }

  // ── Measure drift ─────────────────────────────────────────────────────────
  let maxDrift = 0;
  let maxDriftTick = 0;
  const driftLog: string[] = [];

  for (let i = 0; i < TAIL_TICKS; i++) {
    const base = baselineRenders[i];
    const cand = candidateRenders[i];
    if (!base || !cand) continue;
    const drift = Math.abs(base.x - cand.x) + Math.abs(base.y - cand.y);
    if (drift > maxDrift) {
      maxDrift = drift;
      maxDriftTick = i;
    }
    if (i < 10 || drift > 0.01) {
      driftLog.push(
        `  tick+${i}: base=(${base.x.toFixed(3)},${base.y.toFixed(3)}) ` +
          `cand=(${cand.x.toFixed(3)},${cand.y.toFixed(3)}) drift=${drift.toFixed(4)}`,
      );
    }
  }

  // Also measure drift between full-restore and baseline (should be ~0).
  let maxFullRestoreDrift = 0;
  for (let i = 0; i < TAIL_TICKS; i++) {
    const base = baselineRenders[i];
    const fr = fullRestoreRenders[i];
    if (!base || !fr) continue;
    const drift = Math.abs(base.x - fr.x) + Math.abs(base.y - fr.y);
    maxFullRestoreDrift = Math.max(maxFullRestoreDrift, drift);
  }

  console.log(
    `[applyFidelity] fork at tick ${forkTick}, tail=${TAIL_TICKS} ticks`,
  );
  console.log(
    `[applyFidelity] full-restore drift (rapierBytes baseline): ${maxFullRestoreDrift.toFixed(6)} (should be ~0)`,
  );
  console.log(
    `[applyFidelity] lightweight pos/vel drift: max=${maxDrift.toFixed(4)} at tail-tick+${maxDriftTick}`,
  );
  console.log(`[applyFidelity] Ball drift sample (first divergence points):`);
  for (const line of driftLog.slice(0, 20)) console.log(line);
  if (driftLog.length > 20) console.log(`  ... (${driftLog.length - 20} more)`);

  // Measure drift over the short window (typical reconciliation replay window).
  let maxShortDrift = 0;
  for (let i = 0; i < Math.min(SHORT_TAIL, TAIL_TICKS); i++) {
    const base = baselineRenders[i];
    const cand = candidateRenders[i];
    if (!base || !cand) continue;
    const drift = Math.abs(base.x - cand.x) + Math.abs(base.y - cand.y);
    maxShortDrift = Math.max(maxShortDrift, drift);
  }

  console.log(
    `[applyFidelity] Short-window drift (first ${SHORT_TAIL} ticks, typical reconciliation window): ${maxShortDrift.toFixed(6)}`,
  );
  console.log(
    `[applyFidelity] Long-window drift (full ${TAIL_TICKS} ticks including wall bounces): ${maxDrift.toFixed(4)} at tail-tick+${maxDriftTick}`,
  );
  console.log(
    `[applyFidelity] Decision (0b): short-window drift=${maxShortDrift.toFixed(4)} (tol=${BALL_TOL_SHORT}) — ${
      maxShortDrift < BALL_TOL_SHORT
        ? "straight-flight faithful; HOWEVER, wall-bounce contact-solver diverges (see long-window drift)"
        : "UNFAITHFUL even in short window — use rapierBytes"
    }`,
  );
  console.log(
    "[applyFidelity] Recommendation: WorldSnapshot carries rapierBytes (full Rapier state) OR",
    "asymmetric reconciliation (kinematic player rollback + ball authoritative-pos smoothing).",
    "The contact-solver warm-start state is NOT captured by lightweight pos/vel alone.",
  );

  // ── Assertions ────────────────────────────────────────────────────────────
  // The full-restore (rapierBytes) baseline is perfectly faithful.
  expect(maxFullRestoreDrift).toBe(0);

  // Over the short reconciliation-replay window, lightweight pos/vel is faithful
  // enough (ball in straight flight, no contact-solver state needed).
  // The LONG-TAIL divergence at wall contact is expected and documented above.
  expect(maxShortDrift).toBeLessThan(BALL_TOL_SHORT);
});
