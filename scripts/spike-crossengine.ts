/**
 * Cross-engine determinism spike (Phase 0, Spike 0a) — standalone harness.
 *
 * Steps the same long contact-heavy scripted session as crossEngine.test.ts
 * and prints the resulting `hashState()`. Run under both engines and compare:
 *
 *   # Node (V8):
 *   npx tsx scripts/spike-crossengine.ts
 *   # or: node --experimental-strip-types scripts/spike-crossengine.ts
 *
 *   # Bun (JSC):
 *   bun run scripts/spike-crossengine.ts
 *
 * A matching hash across both engines confirms determinism parity (Q1 resolved).
 * A divergence means Bun/JSC and Node/V8 produce different physics → the
 * `apps/server` runtime/transport factory must fall back to Node.
 *
 * The golden hash committed in crossEngine.test.ts is: 55e8ff50
 * (FLI-9 tall redesign: FLAT_DOJO 16u tall + jumpSpeed 11→12)
 */

import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
} from "../packages/sim/src/index.ts";

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

/**
 * Extended contact-heavy scripted session — same sequence as crossEngine.test.ts.
 * Must stay in sync with that file.
 */
function longContactHeavyScript(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  // ── Start the match (both players press jump) ────────────────────────────
  frames.push([
    f({ jumpPressed: true, jumpHeld: true }),
    f({ jumpPressed: true, jumpHeld: true }),
  ]);

  // ── Settle on the ground ─────────────────────────────────────────────────
  for (let i = 0; i < 20; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // ── Slot 0 walks right, slot 1 walks left — both converging ─────────────
  for (let i = 0; i < 25; i++)
    frames.push([f({ moveX: 1 }), f({ moveX: -1 })]);

  // ── Both players jump at the same time ──────────────────────────────────
  frames.push([
    f({ moveX: 1, jumpPressed: true, jumpHeld: true }),
    f({ moveX: -1, jumpPressed: true, jumpHeld: true }),
  ]);
  for (let i = 0; i < 15; i++)
    frames.push([
      f({ moveX: 1, jumpHeld: true }),
      f({ moveX: -1, jumpHeld: true }),
    ]);

  // ── Slot 0 does a charged strike (upward) in mid-air ────────────────────
  frames.push([
    f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
    f({ moveX: -1 }),
  ]);
  for (let i = 0; i < 12; i++) {
    frames.push([
      f({ moveX: 1, moveY: 1, strikeHeld: true }),
      f({ moveX: -1 }),
    ]);
  }
  frames.push([
    f({ moveX: 1, moveY: 1, strikeReleased: true }),
    EMPTY_INPUT,
  ]);

  // ── Let the ball fly (bounces off walls / ceiling) ───────────────────────
  for (let i = 0; i < 60; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // ── Slot 1 Tele-Dash left ────────────────────────────────────────────────
  frames.push([EMPTY_INPUT, f({ moveX: -1, dashPressed: true, dashHeld: true })]);
  for (let i = 0; i < 5; i++) frames.push([EMPTY_INPUT, f({ moveX: -1 })]);

  // ── Slot 1 jumps and tries an aerial upward strike toward the left Bell ──
  frames.push([
    EMPTY_INPUT,
    f({ moveX: -1, jumpPressed: true, jumpHeld: true }),
  ]);
  for (let i = 0; i < 8; i++)
    frames.push([EMPTY_INPUT, f({ moveX: -1, jumpHeld: true })]);
  frames.push([
    EMPTY_INPUT,
    f({ moveX: -1, moveY: 1, strikeHeld: true, strikePressed: true }),
  ]);
  for (let i = 0; i < 10; i++) {
    frames.push([EMPTY_INPUT, f({ moveX: -1, moveY: 1, strikeHeld: true })]);
  }
  frames.push([EMPTY_INPUT, f({ moveX: -1, moveY: 1, strikeReleased: true })]);

  // ── Extended settle + ball bounces (contact-solver activity) ────────────
  for (let i = 0; i < 80; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // ── Slot 0 walks left and does a grounded strike ────────────────────────
  for (let i = 0; i < 20; i++) frames.push([f({ moveX: -1 }), EMPTY_INPUT]);
  frames.push([
    f({ moveX: -1, strikeHeld: true, strikePressed: true }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 8; i++) {
    frames.push([f({ moveX: -1, strikeHeld: true }), EMPTY_INPUT]);
  }
  frames.push([f({ moveX: -1, strikeReleased: true }), EMPTY_INPUT]);

  // ── Long idle: let physics converge, timer tick down ────────────────────
  for (let i = 0; i < 120; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // ── Slot 1 attempts a spike (downward aerial strike) ────────────────────
  for (let i = 0; i < 10; i++) frames.push([EMPTY_INPUT, f({ moveX: 1 })]);
  frames.push([
    EMPTY_INPUT,
    f({ moveX: 1, jumpPressed: true, jumpHeld: true }),
  ]);
  for (let i = 0; i < 6; i++)
    frames.push([EMPTY_INPUT, f({ jumpHeld: true })]);
  frames.push([
    EMPTY_INPUT,
    f({ moveY: -1, strikeHeld: true, strikePressed: true }),
  ]);
  for (let i = 0; i < 6; i++) {
    frames.push([EMPTY_INPUT, f({ moveY: -1, strikeHeld: true })]);
  }
  frames.push([EMPTY_INPUT, f({ moveY: -1, strikeReleased: true })]);

  // ── Final settle ─────────────────────────────────────────────────────────
  for (let i = 0; i < 60; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  return frames;
}

async function main(): Promise<void> {
  await initSim();

  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
  });

  const script = longContactHeavyScript();
  console.log(`[spike-crossengine] Stepping ${script.length} frames...`);
  for (const row of script) sim.step(row);

  const hash = sim.hashState();
  const expectedHash = "55e8ff50";

  console.log(`[spike-crossengine] hashState() = ${hash}`);
  console.log(`[spike-crossengine] Expected    = ${expectedHash}`);
  console.log(
    `[spike-crossengine] Match: ${hash === expectedHash ? "YES ✓ (determinism parity confirmed)" : "NO ✗ (JSC/V8 divergence detected!)"}`,
  );

  if (hash !== expectedHash) {
    console.error(
      "[spike-crossengine] DIVERGENCE: Bun/JSC and Node/V8 produce different physics.",
    );
    console.error(
      "[spike-crossengine] Action: apps/server must use Node + @colyseus/uwebsockets-transport.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
