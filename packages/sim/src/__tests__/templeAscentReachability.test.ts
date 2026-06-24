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
 *  (e) The ramp descends from the landing (y4) to center floor level (y0).
 */

import { expect, test } from "vitest";
import { type BoxCollider, type RampCollider, TEMPLE_ASCENT } from "../arena";
import { DEFAULT_CONFIG } from "../config";

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

test("the ramp descends from the landing (y4) to center floor level (a clear rolls downhill)", () => {
  const ys = rightRamp.points.map(([, y]) => y);
  expect(Math.min(...ys)).toBeCloseTo(0, 5);
  expect(Math.max(...ys)).toBeCloseTo(4, 5);
});
