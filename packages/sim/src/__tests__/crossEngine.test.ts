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
// FLI-9 Phase 6: radiusBonus (f64) + rampTicks (i32) appended to serializeBellRingState → new hash.
const EXPECTED_HASH = "4a909c30";

beforeAll(async () => {
  await initSim();
});

/**
 * Extended contact-heavy scripted session.
 *
 * Extends the replay.test.ts scriptedFrameList() shape with additional
 * sequences that exercise:
 *  - Both players active (slot 1 moves toward slot 0)
 *  - Ball bouncing off the floor, ceiling, and walls
 *  - A charged aerial Strike aimed at the Bell hit-zone (contact-heavy)
 *  - Golden Goal match phase transition (timer exhausted)
 *  - Multiple Bell ring attempts (ball bounced into the elevated Bell zone)
 *
 * The goal is maximal contact-solver activity so JSC vs V8 floating-point
 * divergence (if any) surfaces quickly.
 */
function longContactHeavyScript(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  function f(partial: Partial<InputFrame>): InputFrame {
    return { ...EMPTY_INPUT, ...partial };
  }

  // Helper: sparse row keyed by the 1v1 [0, 2] template.
  // slot 0 = left player (same position as old "slot 0")
  // slot 2 = right player (same position as old "slot 1": spawn at x=4)
  function row(s0: InputFrame, s2: InputFrame): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = s0;
    r[2] = s2;
    return r;
  }

  // ── Start the match (both players press jump) ────────────────────────────
  frames.push(
    row(
      f({ jumpPressed: true, jumpHeld: true }),
      f({ jumpPressed: true, jumpHeld: true }),
    ),
  );

  // ── Settle on the ground ─────────────────────────────────────────────────
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── Slot 0 walks right, slot 2 walks left — both converging ─────────────
  for (let i = 0; i < 25; i++)
    frames.push(row(f({ moveX: 1 }), f({ moveX: -1 })));

  // ── Both players jump at the same time ──────────────────────────────────
  frames.push(
    row(
      f({ moveX: 1, jumpPressed: true, jumpHeld: true }),
      f({ moveX: -1, jumpPressed: true, jumpHeld: true }),
    ),
  );
  for (let i = 0; i < 15; i++)
    frames.push(
      row(f({ moveX: 1, jumpHeld: true }), f({ moveX: -1, jumpHeld: true })),
    );

  // ── Slot 0 does a charged strike (upward) in mid-air ────────────────────
  frames.push(
    row(
      f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
      f({ moveX: -1 }),
    ),
  );
  for (let i = 0; i < 12; i++) {
    frames.push(
      row(f({ moveX: 1, moveY: 1, strikeHeld: true }), f({ moveX: -1 })),
    );
  }
  frames.push(
    row(f({ moveX: 1, moveY: 1, strikeReleased: true }), EMPTY_INPUT),
  );

  // ── Let the ball fly (bounces off walls / ceiling) ───────────────────────
  for (let i = 0; i < 60; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── Slot 2 Tele-Dash left ────────────────────────────────────────────────
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, dashPressed: true, dashHeld: true })),
  );
  for (let i = 0; i < 5; i++) frames.push(row(EMPTY_INPUT, f({ moveX: -1 })));

  // ── Slot 2 jumps and tries an aerial upward strike toward the left Bell ──
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, jumpPressed: true, jumpHeld: true })),
  );
  for (let i = 0; i < 8; i++)
    frames.push(row(EMPTY_INPUT, f({ moveX: -1, jumpHeld: true })));
  frames.push(
    row(
      EMPTY_INPUT,
      f({ moveX: -1, moveY: 1, strikeHeld: true, strikePressed: true }),
    ),
  );
  for (let i = 0; i < 10; i++) {
    frames.push(row(EMPTY_INPUT, f({ moveX: -1, moveY: 1, strikeHeld: true })));
  }
  frames.push(
    row(EMPTY_INPUT, f({ moveX: -1, moveY: 1, strikeReleased: true })),
  );

  // ── Extended settle + ball bounces (contact-solver activity) ────────────
  for (let i = 0; i < 80; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── Slot 0 walks left and does a grounded strike ────────────────────────
  for (let i = 0; i < 20; i++) frames.push(row(f({ moveX: -1 }), EMPTY_INPUT));
  frames.push(
    row(f({ moveX: -1, strikeHeld: true, strikePressed: true }), EMPTY_INPUT),
  );
  for (let i = 0; i < 8; i++) {
    frames.push(row(f({ moveX: -1, strikeHeld: true }), EMPTY_INPUT));
  }
  frames.push(row(f({ moveX: -1, strikeReleased: true }), EMPTY_INPUT));

  // ── Long idle: let physics converge, timer tick down ────────────────────
  for (let i = 0; i < 120; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

  // ── Slot 2 attempts a spike (downward aerial strike) ────────────────────
  for (let i = 0; i < 10; i++) frames.push(row(EMPTY_INPUT, f({ moveX: 1 })));
  frames.push(
    row(EMPTY_INPUT, f({ moveX: 1, jumpPressed: true, jumpHeld: true })),
  );
  for (let i = 0; i < 6; i++)
    frames.push(row(EMPTY_INPUT, f({ jumpHeld: true })));
  frames.push(
    row(EMPTY_INPUT, f({ moveY: -1, strikeHeld: true, strikePressed: true })),
  );
  for (let i = 0; i < 6; i++) {
    frames.push(row(EMPTY_INPUT, f({ moveY: -1, strikeHeld: true })));
  }
  frames.push(row(EMPTY_INPUT, f({ moveY: -1, strikeReleased: true })));

  // ── Final settle ─────────────────────────────────────────────────────────
  for (let i = 0; i < 60; i++) frames.push(row(EMPTY_INPUT, EMPTY_INPUT));

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
