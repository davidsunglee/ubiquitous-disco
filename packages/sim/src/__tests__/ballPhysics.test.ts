import { beforeAll, expect, test } from "vitest";
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
