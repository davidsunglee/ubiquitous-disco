import { beforeAll, expect, test } from "vitest";
import { FLAT_DOJO } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import { initSim } from "../rapier";
import { RapierWorld } from "../rapier-world";
import { COMPACT_DOJO } from "./fixtures/compactArena";

beforeAll(async () => {
  await initSim();
});

// A hard Strike can drive the ball faster than a wall is thick per tick (the
// strike impulse is applied before the per-tick speed clamp, so the ball can
// enter a world step well above maxSpeed). At 30 Hz a discrete solver steps the
// ball clean through the 0.5-half-width walls. CCD (swept collision) must keep
// the ball inside the arena (right wall inner face at x = 11.5; ball radius 0.3
// → center stays ≤ ~11.2, modulo a little restitution overlap).
test("a hard-struck ball does not tunnel through the wall (CCD)", () => {
  // Compact fixture (wall inner face at x = 11.5) so the ball reaches the wall
  // within the frame budget — production arenas are far wider.
  const rw = new RapierWorld(DEFAULT_CONFIG, COMPACT_DOJO);
  // Worst-case burst: clamped maxSpeed plus a full strike impulse toward the wall.
  const burst = DEFAULT_CONFIG.ball.maxSpeed + 32;
  rw.setBallVel(burst, 0); // straight at the right wall
  let maxX = -Infinity;
  for (let i = 0; i < 40; i++) {
    rw.step();
    maxX = Math.max(maxX, rw.ballPos().x);
  }
  expect(maxX).toBeLessThan(11.5 - DEFAULT_CONFIG.ball.radius + 0.1);
});

// FLI-11 Phase 2: ball floats.
// gravityScale is a construction-time Rapier field — use RapierWorld directly
// to compare configs without a reload. Launch the ball straight up and count how
// many ticks it stays above its start height. The floaty config (gravityScale 0.32)
// should keep it aloft far longer than a heavy baseline (gravityScale 1.0).
test("a struck-up ball hangs far longer than a heavy (gravityScale 1) ball", () => {
  const launchUpAndCountAboveStart = (gravityScale: number): number => {
    const cfg = {
      ...DEFAULT_CONFIG,
      ball: { ...DEFAULT_CONFIG.ball, gravityScale },
    };
    const rw = new RapierWorld(cfg, FLAT_DOJO);
    const y0 = rw.ballPos().y;
    // Impart a strong upward velocity (matches a typical charged strike impulse).
    rw.setBallVel(0, 14);
    let ticks = 0;
    for (let i = 0; i < 300; i++) {
      rw.step();
      if (rw.ballPos().y > y0) ticks++;
    }
    return ticks;
  };

  const floatyTicks = launchUpAndCountAboveStart(0.32);
  const heavyTicks = launchUpAndCountAboveStart(1.0);

  // Floaty config keeps the ball aloft for many more ticks than gravityScale 1.
  expect(floatyTicks).toBeGreaterThan(heavyTicks * 2);
});
