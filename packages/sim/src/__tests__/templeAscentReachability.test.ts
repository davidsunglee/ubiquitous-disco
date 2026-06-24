/**
 * Reachability and geometry tests for the Temple Ascent arena.
 *
 * All constants derived from the live ArenaDef — tuning numbers in arena.ts are
 * the single source of truth; these tests just assert the invariants hold.
 *
 * Invariants:
 *  (a) Center lane is open: only floor, ceiling, and ramps exist for |x| < 30.
 *  (b) Bell is reachable from the ramp landing: landing feet + jump apex clears it.
 *  (c) The raised eave covers the Bell from directly above (blocks top-down drop).
 *  (d) The mouth lip sits inside the bay mouth at lob height (obstructs lobs).
 *  (e) The ramp descends from the landing (y4) through the center floor edge
 *      with its toe tucked underneath the floor, avoiding a seam lip.
 */

import { beforeAll, expect, test } from "vitest";
import { type BoxCollider, type RampCollider, TEMPLE_ASCENT } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import { createSimulation, EMPTY_INPUT, initSim } from "../index";

beforeAll(async () => {
  await initSim();
});

const floor = TEMPLE_ASCENT.colliders[0];
const ceiling = TEMPLE_ASCENT.colliders[TEMPLE_ASCENT.colliders.length - 1];

const rightBell = TEMPLE_ASCENT.bells.find((b) => b.id === "right")!;

const rightRamp = TEMPLE_ASCENT.colliders.find(
  (c): c is RampCollider => c.kind === "ramp" && c.points.some(([x]) => x > 0),
)!;

const rightEave = TEMPLE_ASCENT.colliders.find(
  (c): c is BoxCollider => c.kind === "box" && c.x > 30 && c.x < 45 && c.y > 8,
)!; // raised eave: underside y8.7

const rightLip = TEMPLE_ASCENT.colliders.find(
  (c): c is BoxCollider =>
    c.kind === "box" && Math.abs(c.x - 37.3) < 1 && c.halfW < 0.5,
)!; // thin mouth lip at the bay mouth

const jumpApexAboveFeet = () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY * DEFAULT_CONFIG.movement.gravityScale;
  return (v * v) / (2 * g); // ≈ 9.08u above feet
};

// ── (a) Center lane open ──────────────────────────────────────────────────────

test("center lane is open: only floor/ceiling/ramps for |x| < 30", () => {
  for (const c of TEMPLE_ASCENT.colliders) {
    if (c === floor || c === ceiling || c.kind === "ramp") continue;
    // Every remaining box must be at |x| >= 30
    if (c.kind === "box") {
      expect(
        Math.abs(c.x),
        `box at x=${c.x} y=${c.y} intrudes into center lane`,
      ).toBeGreaterThanOrEqual(30);
    }
  }
});

// ── (b) Bell reachable from the ramp landing ─────────────────────────────────

test("Bell is reachable from the ramp landing (landing feet + jump apex clears it)", () => {
  const landingY = Math.max(...rightRamp.points.map(([, y]) => y)); // 4
  expect(landingY + jumpApexAboveFeet()).toBeGreaterThan(rightBell.hitZone.y);
});

// ── (c) Eave covers the Bell from above ──────────────────────────────────────

test("the raised eave covers the Bell from directly above (blocks a top-down drop)", () => {
  expect(rightEave).toBeDefined();
  expect(rightBell.hitZone.x).toBeGreaterThanOrEqual(
    rightEave.x - rightEave.halfW,
  );
  expect(rightBell.hitZone.x).toBeLessThanOrEqual(
    rightEave.x + rightEave.halfW,
  );
  // Eave underside is above the Bell center (pocket formed above the Bell).
  expect(rightEave.y - rightEave.halfH).toBeGreaterThan(rightBell.hitZone.y);
});

// ── (d) Mouth lip sits inside the bay mouth at lob height ────────────────────

test("the mouth lip sits inside the bay mouth at lob height", () => {
  expect(rightLip).toBeDefined();
  // Lip is inner of the Bell (between center and Bell)
  expect(rightLip.x).toBeLessThan(rightBell.hitZone.x);
  // Lip hangs below the eave underside
  expect(rightLip.y - rightLip.halfH).toBeLessThan(
    rightEave.y - rightEave.halfH + 0.01,
  );
  // Lip top is above the Bell (obstructs lobs from center)
  expect(rightLip.y + rightLip.halfH).toBeGreaterThan(rightBell.hitZone.y);
});

// ── (e) Ramp descends from landing to floor ──────────────────────────────────

test("the ramp descends from the landing through the center floor edge without a raised seam lip", () => {
  const landingY = Math.max(...rightRamp.points.map(([, y]) => y));
  const toe = rightRamp.points.reduce((inner, point) =>
    point[0] < inner[0] ? point : inner,
  );
  const landingStart = rightRamp.points
    .filter(([, y]) => y === landingY)
    .reduce((inner, point) => (point[0] < inner[0] ? point : inner));

  const floorEdgeX = TEMPLE_ASCENT.bayRampBaseX?.right ?? 30;
  const slopeT = (floorEdgeX - toe[0]) / (landingStart[0] - toe[0]);
  const slopeYAtFloorEdge = toe[1] + (landingStart[1] - toe[1]) * slopeT;

  expect(landingY).toBeCloseTo(4, 5);
  expect(toe[0]).toBeLessThan(floorEdgeX);
  expect(toe[1]).toBeLessThan(0);
  expect(slopeYAtFloorEdge).toBeLessThanOrEqual(0.01);
  expect(slopeYAtFloorEdge).toBeGreaterThan(-0.1);
});

test.each([
  { direction: "right", moveX: 1, baseX: 30, landingX: 44 },
  { direction: "left", moveX: -1, baseX: -30, landingX: -44 },
])("a player can hold $direction from the center floor onto the $direction ramp and landing", ({
  moveX,
  baseX,
  landingX,
}) => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: TEMPLE_ASCENT,
    seed: 12,
    activeSlots: [0],
  });

  sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);

  let stalledAtRampBaseTicks = 0;
  let previousX = sim.getRenderState().players[0]?.x ?? -Infinity;

  for (let i = 0; i < 210; i++) {
    sim.step([{ ...EMPTY_INPUT, moveX }]);
    const player = sim.getRenderState().players[0];
    if (!player) throw new Error("slot 0 missing from render state");

    const nearRampBase = Math.abs(player.x - baseX) < 0.6;
    const progress = (player.x - previousX) * Math.sign(moveX);
    if (nearRampBase && progress <= 0.02) {
      stalledAtRampBaseTicks += 1;
    }
    previousX = player.x;
  }

  const player = sim.getRenderState().players[0];
  if (!player) throw new Error("slot 0 missing from render state");

  expect(stalledAtRampBaseTicks).toBe(0);
  expect(player.x * Math.sign(moveX)).toBeGreaterThan(
    landingX * Math.sign(moveX),
  );
  expect(player.y).toBeGreaterThan(4.5);
});

test.each([
  { direction: "right", moveX: 1, startX: 29.2, crossedX: 31 },
  { direction: "left", moveX: -1, startX: -29.2, crossedX: -31 },
])("a player settled at the $direction ramp base can keep walking onto the slope", ({
  moveX,
  startX,
  crossedX,
}) => {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: TEMPLE_ASCENT,
    seed: 13,
    activeSlots: [0],
  });

  sim.step([{ ...EMPTY_INPUT, jumpPressed: true, jumpHeld: true }]);
  sim.setSlotKinematicPosition(0, startX, 0.81);
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT]);

  for (let i = 0; i < 20; i++) {
    sim.step([{ ...EMPTY_INPUT, moveX }]);
  }

  const player = sim.getRenderState().players[0];
  if (!player) throw new Error("slot 0 missing from render state");

  expect(player.x * Math.sign(moveX)).toBeGreaterThan(
    crossedX * Math.sign(moveX),
  );
  expect(player.grounded).toBe(true);
});
