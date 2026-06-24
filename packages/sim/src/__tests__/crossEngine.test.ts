/**
 * Cross-engine determinism parity test (Phase 0, Spike 0a).
 *
 * Runs a long, contact-heavy scripted session — including a Bell hit — and
 * asserts `hashState()` equals a committed golden constant computed on V8/Node.
 *
 * Because this same file runs under both `vitest` (V8) and
 * `bun --bun vitest run` (JSC), any JSC↔V8 divergence fails the test when
 * run under Bun.
 *
 * Golden hash source: first run under `node` / standard `pnpm test`.
 * Update EXPECTED_HASH if the sim physics or scripted input change.
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

// Golden hash computed on V8 (Node 22 / Vitest 4.1.9, @dimforge/rapier2d-deterministic-compat 0.19.x).
// If Bun/JSC diverges, this fails under `bun --bun vitest run`.
// To regenerate: run this test with EXPECTED_HASH = "PLACEHOLDER" and read the console output.
// FLI-11 Phase 5: flat-court rally script (jump → aerial header → ceiling bounce → re-hit → Bell ring).
// SIM_CONFIG_VERSION = 9; actor 84 bytes; ball gravityScale 0.32; jump apex ~9.08u.
const EXPECTED_HASH = "5a23c794";

beforeAll(async () => {
  await initSim();
});

/**
 * Flat-court rally scripted session (FLI-11 Phase 5).
 *
 * Exercises the new Flat Dojo feel in a representative sequence:
 *   1. Match start + floor settle
 *   2. Slot 0 jumps to Bell-threat height and does an aerial header (upward Strike)
 *      — the ball is near the spawn (y=6); the high arc sends it toward the ceiling
 *   3. Ball bounces off the high ceiling (~y=20) and returns — floaty hang time
 *   4. Slot 2 jumps and re-hits the descending ball (aerial tap-Strike)
 *   5. Ball travels toward the left Bell; slot 0 repositions to contest
 *   6. Slot 0 does a grounded tap-Strike to send the ball toward the right Bell
 *   7. Extended settle: ball bounces off walls/floor (contact-solver activity)
 *   8. Slot 2 jumps + downward spike from near-apex height
 *   9. Slot 0 jumps + upward tap-Strike in the 3-tick grace window
 *  10. Final settle — timer drains
 *
 * The purpose is maximal contact-solver activity so JSC vs V8 floating-point
 * divergence (if any) surfaces quickly, with inputs that reflect the new
 * flat open aerial-volley court rather than the old ladder geometry.
 */
function longContactHeavyScript(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  function f(partial: Partial<InputFrame>): InputFrame {
    return { ...EMPTY_INPUT, ...partial };
  }

  // Helper: sparse row keyed by the 1v1 [0, 2] template.
  // slot 0 = left player (spawns at x=-4, y=1)
  // slot 2 = right player (spawns at x=4, y=1)
  function row(s0: InputFrame, s2: InputFrame): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = s0;
    r[2] = s2;
    return r;
  }

  // ── 1. Start the match (both players press jump to exit preRound) ────────
  frames.push(
    row(
      f({ jumpPressed: true, jumpHeld: true }),
      f({ jumpPressed: true, jumpHeld: true }),
    ),
  );

  // ── Settle on the ground after preRound ──────────────────────────────────
  for (let i = 0; i < 15; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── 2. Slot 0 jumps toward the ball (spawned at y=6) and does an aerial
  //       header (upward neutral Strike): jump → rise → tap-Strike at apex ──
  // Walk a few steps right to get under the ball.
  for (let i = 0; i < 5; i++) frames.push(row(f({ moveX: 1 }), EMPTY_INPUT));
  // Full jump (held for floaty, higher arc).
  frames.push(row(f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT));
  for (let i = 0; i < 14; i++)
    frames.push(row(f({ jumpHeld: true }), EMPTY_INPUT));
  // Tap-Strike at/near apex — neutral direction (up bias) sends ball toward ceiling.
  frames.push(
    row(f({ moveY: 1, strikeHeld: true, strikePressed: true }), EMPTY_INPUT),
  );
  frames.push(row(f({ moveY: 1, strikeReleased: true }), EMPTY_INPUT));

  // ── 3. Ball rises toward the ceiling (~y=20) and bounces back down ───────
  // Let both players land and the ball travel upward. Slot 2 starts walking
  // left to position under the descending ball.
  for (let i = 0; i < 30; i++) frames.push(row(EMPTY_INPUT, f({ moveX: -1 })));

  // ── 4. Slot 2 jumps and re-hits the descending ball (aerial tap-Strike) ──
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, jumpPressed: true, jumpHeld: true })),
  );
  for (let i = 0; i < 12; i++)
    frames.push(row(EMPTY_INPUT, f({ moveX: -1, jumpHeld: true })));
  // Upward tap-Strike while airborne — sends ball back up and toward left Bell.
  frames.push(
    row(
      EMPTY_INPUT,
      f({ moveX: -1, moveY: 1, strikeHeld: true, strikePressed: true }),
    ),
  );
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, moveY: 1, strikeReleased: true })),
  );

  // ── 5. Both players reposition; ball floats toward left Bell region ───────
  // Slot 0 walks left toward its Bell side; slot 2 retreats right.
  for (let i = 0; i < 20; i++)
    frames.push(row(f({ moveX: -1 }), f({ moveX: 1 })));

  // ── 6. Slot 0 grounded tap-Strike to redirect ball toward right Bell ─────
  frames.push(
    row(f({ moveX: 1, strikeHeld: true, strikePressed: true }), EMPTY_INPUT),
  );
  frames.push(row(f({ moveX: 1, strikeReleased: true }), EMPTY_INPUT));

  // ── 7. Extended settle: ball bounces off walls/floor (contact-solver) ────
  for (let i = 0; i < 60; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // Slot 2 walks left to chase the ball.
  for (let i = 0; i < 15; i++) frames.push(row(EMPTY_INPUT, f({ moveX: -1 })));

  // ── 8. Slot 2 jumps and tries a downward spike ───────────────────────────
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, jumpPressed: true, jumpHeld: true })),
  );
  for (let i = 0; i < 10; i++)
    frames.push(row(EMPTY_INPUT, f({ moveX: -1, jumpHeld: true })));
  // Spike downward while near apex height.
  frames.push(
    row(
      EMPTY_INPUT,
      f({ moveX: -1, moveY: -1, strikeHeld: true, strikePressed: true }),
    ),
  );
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, moveY: -1, strikeReleased: true })),
  );

  // ── Let the spike land and ball bounce ───────────────────────────────────
  for (let i = 0; i < 25; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── 9. Slot 0 jumps + upward tap-Strike (3-tick grace window) ───────────
  // Walk right toward the ball.
  for (let i = 0; i < 10; i++) frames.push(row(f({ moveX: 1 }), EMPTY_INPUT));
  frames.push(row(f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT));
  for (let i = 0; i < 8; i++)
    frames.push(row(f({ moveX: 1, jumpHeld: true }), EMPTY_INPUT));
  // Upward tap — grace window (3 ticks) gives the hit a chance to connect.
  frames.push(
    row(
      f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
      EMPTY_INPUT,
    ),
  );
  frames.push(
    row(f({ moveX: 1, moveY: 1, strikeReleased: true }), EMPTY_INPUT),
  );

  // ── 10. Final settle — timer drains, physics converge ────────────────────
  for (let i = 0; i < 90; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  return frames;
}

test("scripted long contact-heavy session hashes to the golden value (engine-independent)", () => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });
  for (const row of longContactHeavyScript()) sim.step(row);
  const hash = sim.hashState();

  // Log the hash so it's visible in CI output and when run under Bun.
  console.log(`[crossEngine] hashState() = ${hash}`);

  expect(hash).toBe(EXPECTED_HASH);
});
