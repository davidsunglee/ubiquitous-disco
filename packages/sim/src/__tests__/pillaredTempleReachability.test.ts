/**
 * Reachability tests for the Pillared Temple arena (Option C geometry fix).
 *
 * Guards that:
 *  (a) Both pillar tops (inner 2.0u, outer 3.0u) are at or below the floor-jump
 *      apex (3.6u) so a player can jump onto them from the floor.
 *  (b) The right bell hitZone is at y=5.5, x=36.
 *  (c) Floor jump + air-dash reach (apex + dashDistance ≈ 6.6u) is enough to
 *      reach the bell (y=5.5) from a floor jump or pillar-top jump.
 *  (d) A bare floor single-jump apex (3.6u) is below the bell (5.5u), so the
 *      bell still requires aerial effort (jump + dash or climb).
 *
 * Reachability math:
 *   jumpSpeed = 12, gravityY = -20
 *   apex = jumpSpeed² / (2 × |gravityY|) = 144 / 40 = 3.6u
 *   floor jump + air-dash reach ≈ apex + dashDistance = 3.6 + 3.0 = 6.6u
 */

import { expect, test } from "vitest";
import { PILLARED_TEMPLE } from "../arena";
import { DEFAULT_CONFIG } from "../config";

// Derive pillar tops from actual collider definitions (not hardcoded).
const innerPillars = PILLARED_TEMPLE.colliders.filter(
  (c) => Math.abs(Math.abs(c.x) - 12) < 0.01,
);
const outerPillars = PILLARED_TEMPLE.colliders.filter(
  (c) => Math.abs(Math.abs(c.x) - 28) < 0.01,
);

// ── (a) Pillar tops are within single-jump reach from the floor ───────────────

test("Pillared Temple inner pillar tops (x=±12) are jumpable from the floor", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY;
  const apexFeet = (v * v) / (2 * g); // 12²/40 = 3.6

  for (const c of innerPillars) {
    const topY = c.y + c.halfH; // derived from actual collider
    expect(topY).toBeCloseTo(2.0, 5); // inner pillar top at 2.0u
    expect(
      topY,
      `inner pillar at x=${c.x}: top ${topY} must be ≤ jump apex ${apexFeet}`,
    ).toBeLessThanOrEqual(apexFeet);
  }
  expect(innerPillars.length).toBe(2);
});

test("Pillared Temple outer pillar tops (x=±28) are jumpable from the floor", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY;
  const apexFeet = (v * v) / (2 * g); // 12²/40 = 3.6

  for (const c of outerPillars) {
    const topY = c.y + c.halfH; // derived from actual collider
    expect(topY).toBeCloseTo(3.0, 5); // outer pillar top at 3.0u
    expect(
      topY,
      `outer pillar at x=${c.x}: top ${topY} must be ≤ jump apex ${apexFeet}`,
    ).toBeLessThanOrEqual(apexFeet);
  }
  expect(outerPillars.length).toBe(2);
});

// ── (b) Right bell hitZone position ──────────────────────────────────────────

test("Pillared Temple right bell hitZone is at y=5.5, x=36", () => {
  const rightBell = PILLARED_TEMPLE.bells.find((b) => b.id === "right");
  expect(rightBell).toBeDefined();
  expect(rightBell!.hitZone.y).toBeCloseTo(5.5, 5);
  expect(rightBell!.hitZone.x).toBeCloseTo(36, 5);
  expect(rightBell!.hitZone.radius).toBeCloseTo(0.8, 5);
});

// ── (c) Floor jump + air-dash reach clears the bell ──────────────────────────

test("floor jump + air-dash reach (≈6.6u) clears the Pillared Temple bell (5.5u)", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY;
  const apexFeet = (v * v) / (2 * g); // 3.6
  const reachWithDash = apexFeet + DEFAULT_CONFIG.dash.distance; // 3.6 + 3.0 = 6.6

  const rightBell = PILLARED_TEMPLE.bells.find((b) => b.id === "right")!;
  const bellY = rightBell.hitZone.y; // 5.5

  expect(
    reachWithDash,
    `jump+dash reach ${reachWithDash} must exceed bell y ${bellY}`,
  ).toBeGreaterThan(bellY);
});

// ── (d) Bare floor single-jump cannot reach the bell ─────────────────────────

test("bare floor single-jump apex (3.6u) is below the Pillared Temple bell (5.5u)", () => {
  const v = DEFAULT_CONFIG.movement.jumpSpeed;
  const g = -DEFAULT_CONFIG.gravityY;
  const apexFeet = (v * v) / (2 * g); // 3.6

  const rightBell = PILLARED_TEMPLE.bells.find((b) => b.id === "right")!;
  const bellY = rightBell.hitZone.y; // 5.5

  expect(
    apexFeet,
    `bare jump apex ${apexFeet} must be below bell y ${bellY} (aerial move required)`,
  ).toBeLessThan(bellY);
});
