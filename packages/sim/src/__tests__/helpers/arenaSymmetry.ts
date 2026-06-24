import { expect } from "vitest";
import type { ArenaDef, RampCollider } from "../../arena";

/**
 * Two ramps are mirrors of each other about x=0 when one's points are exactly
 * the x-negated set of the other (order-insensitive).
 */
export function rampsMirror(a: RampCollider, b: RampCollider): boolean {
  if (a.points.length !== b.points.length) return false;
  const k = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
  const want = new Set(a.points.map(([x, y]) => k(-x, y)));
  return b.points.every(([x, y]) => want.has(k(x, y)));
}

/**
 * Assert that every collider and bell in the arena has an x-mirrored
 * counterpart (symmetric about x=0). Ramps mirror when one's points are the
 * x-negated set of the other. Box colliders mirror when another box has the
 * same |x|, y, halfW, halfH.
 */
export function testArenaMirrorSymmetry(arena: ArenaDef): void {
  const name = arena.id;

  // ── Collider mirror symmetry ──
  for (const c of arena.colliders) {
    const hasMirror =
      c.kind === "ramp"
        ? arena.colliders.some(
            (m): m is RampCollider => m.kind === "ramp" && rampsMirror(c, m),
          )
        : arena.colliders.some(
            (m) =>
              m.kind === "box" &&
              Math.abs(m.x - -c.x) < 1e-6 &&
              Math.abs(m.y - c.y) < 1e-6 &&
              Math.abs(m.halfW - c.halfW) < 1e-6 &&
              Math.abs(m.halfH - c.halfH) < 1e-6,
          );
    expect(
      hasMirror,
      `[${name}] collider at ${JSON.stringify(c)} has no mirror`,
    ).toBe(true);
  }

  // ── Bell mirror symmetry ──
  const leftBell = arena.bells.find((b) => b.id === "left");
  const rightBell = arena.bells.find((b) => b.id === "right");
  expect(leftBell, `[${name}] missing left bell`).toBeDefined();
  expect(rightBell, `[${name}] missing right bell`).toBeDefined();
  if (!leftBell || !rightBell) return;

  expect(
    Math.abs(leftBell.hitZone.x + rightBell.hitZone.x),
    `[${name}] bell hitZone x not mirrored`,
  ).toBeLessThan(1e-6);
  expect(
    Math.abs(leftBell.hitZone.y - rightBell.hitZone.y),
    `[${name}] bell hitZone y not equal`,
  ).toBeLessThan(1e-6);
  expect(
    Math.abs(leftBell.hitZone.radius - rightBell.hitZone.radius),
    `[${name}] bell hitZone radius not equal`,
  ).toBeLessThan(1e-6);
  expect(
    Math.abs(leftBell.art.x + rightBell.art.x),
    `[${name}] bell art x not mirrored`,
  ).toBeLessThan(1e-6);
}
