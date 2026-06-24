/**
 * Arena registry tests (Phase 5, FLI-9).
 *
 * Verifies:
 *  1. Registry completeness — every ArenaId maps to an ArenaDef in ARENAS.
 *  2. Mirror symmetry — every collider and bell has an x-mirrored counterpart.
 *  3. playerSpawns — all four slots defined for every arena.
 *  4. Bell hit-zones — positive radius, `defends` consistent with side.
 *  5. resolveArena — known id returns the right arena, unknown id falls back to FLAT_DOJO.
 */

import { expect, test } from "vitest";
import {
  ARENAS,
  type ArenaDef,
  type ArenaId,
  FLAT_DOJO,
  PILLARED_TEMPLE,
  resolveArena,
  TWIN_LEDGE,
} from "../arena";

const ARENA_IDS: ArenaId[] = ["flat-dojo", "pillared-temple", "twin-ledge"];

// ── Registry completeness ──────────────────────────────────────────────────────

test("ARENAS registry contains all three ArenaId keys", () => {
  for (const id of ARENA_IDS) {
    expect(ARENAS).toHaveProperty(id);
    expect(ARENAS[id]).toBeDefined();
  }
});

test("ARENAS registry has exactly three entries", () => {
  expect(Object.keys(ARENAS)).toHaveLength(3);
});

test("ARENAS keys match the arena def ids", () => {
  for (const id of ARENA_IDS) {
    expect(ARENAS[id]?.id).toBe(id);
  }
});

test("FLAT_DOJO, PILLARED_TEMPLE, TWIN_LEDGE are exported and match registry", () => {
  expect(ARENAS["flat-dojo"]).toBe(FLAT_DOJO);
  expect(ARENAS["pillared-temple"]).toBe(PILLARED_TEMPLE);
  expect(ARENAS["twin-ledge"]).toBe(TWIN_LEDGE);
});

// ── resolveArena ──────────────────────────────────────────────────────────────

test("resolveArena returns the correct arena for known ids", () => {
  expect(resolveArena("flat-dojo")).toBe(FLAT_DOJO);
  expect(resolveArena("pillared-temple")).toBe(PILLARED_TEMPLE);
  expect(resolveArena("twin-ledge")).toBe(TWIN_LEDGE);
});

test("resolveArena falls back to FLAT_DOJO for unknown ids", () => {
  expect(resolveArena("unknown-arena")).toBe(FLAT_DOJO);
  expect(resolveArena("")).toBe(FLAT_DOJO);
});

// ── Per-arena property tests ───────────────────────────────────────────────────

function testArenaMirrorSymmetry(arena: ArenaDef): void {
  const name = arena.id;

  // ── Collider mirror symmetry ──
  // For every collider, there must be a collider with mirrored x (same |x|),
  // same y, same halfW, same halfH. The collider may mirror itself if x=0.
  for (const c of arena.colliders) {
    const mirrorX = -c.x;
    const hasMirror = arena.colliders.some(
      (m) =>
        Math.abs(m.x - mirrorX) < 1e-6 &&
        Math.abs(m.y - c.y) < 1e-6 &&
        Math.abs(m.halfW - c.halfW) < 1e-6 &&
        Math.abs(m.halfH - c.halfH) < 1e-6,
    );
    expect(hasMirror, `[${name}] collider at x=${c.x} has no mirror`).toBe(
      true,
    );
  }

  // ── Bell mirror symmetry ──
  // Left bell x = -rightBellX, same y, same radius, same halfW/halfH.
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

function testArenaPlayerSpawns(arena: ArenaDef): void {
  expect(
    arena.playerSpawns,
    `[${arena.id}] playerSpawns must be defined`,
  ).toBeDefined();
  expect(
    arena.playerSpawns.length,
    `[${arena.id}] must have 4 player spawns`,
  ).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 4; i++) {
    const spawn = arena.playerSpawns[i];
    expect(spawn, `[${arena.id}] spawn slot ${i} missing`).toBeDefined();
    expect(
      typeof spawn?.x,
      `[${arena.id}] spawn slot ${i} x must be number`,
    ).toBe("number");
    expect(
      typeof spawn?.y,
      `[${arena.id}] spawn slot ${i} y must be number`,
    ).toBe("number");
  }
}

function testArenaBellHitZones(arena: ArenaDef): void {
  const leftBell = arena.bells.find((b) => b.id === "left");
  const rightBell = arena.bells.find((b) => b.id === "right");
  expect(leftBell).toBeDefined();
  expect(rightBell).toBeDefined();
  if (!leftBell || !rightBell) return;

  // Positive radii.
  expect(
    leftBell.hitZone.radius,
    `[${arena.id}] left bell radius > 0`,
  ).toBeGreaterThan(0);
  expect(
    rightBell.hitZone.radius,
    `[${arena.id}] right bell radius > 0`,
  ).toBeGreaterThan(0);

  // `defends` consistent with side (left bell defends left, right defends right).
  expect(leftBell.defends).toBe("left");
  expect(rightBell.defends).toBe("right");

  // Left bell should be on the left side (x < 0), right on the right (x > 0).
  expect(
    leftBell.hitZone.x,
    `[${arena.id}] left bell must be at x < 0`,
  ).toBeLessThan(0);
  expect(
    rightBell.hitZone.x,
    `[${arena.id}] right bell must be at x > 0`,
  ).toBeGreaterThan(0);
}

for (const id of ARENA_IDS) {
  const arena = ARENAS[id]!;

  test(`[${id}] colliders and bells are mirror-symmetric about x=0`, () => {
    testArenaMirrorSymmetry(arena);
  });

  test(`[${id}] playerSpawns covers all four slots`, () => {
    testArenaPlayerSpawns(arena);
  });

  test(`[${id}] bell hit-zones are well-formed`, () => {
    testArenaBellHitZones(arena);
  });

  test(`[${id}] is 72–96 world units wide (large-arena requirement)`, () => {
    // The widest collider is the floor; its full width is 2 * halfW. Arenas are
    // authored large (72–96u) so the adaptive camera engages and play feels big.
    const width = 2 * Math.max(...arena.colliders.map((c) => c.halfW));
    expect(width, `[${id}] width must be ≥ 72`).toBeGreaterThanOrEqual(72);
    expect(width, `[${id}] width must be ≤ 96`).toBeLessThanOrEqual(96);
  });
}

// ── FLAT_DOJO-specific: flat open court (FLI-11) ──────────────────────────────

test("FLAT_DOJO is the flat open court: 4 colliders, high ceiling, low bells, no climb", () => {
  const at = (x: number, y: number) =>
    FLAT_DOJO.colliders.find(
      (c) => Math.abs(c.x - x) < 0.01 && Math.abs(c.y - y) < 0.01,
    );
  // Exactly four colliders: floor, two walls, ceiling.
  expect(FLAT_DOJO.colliders).toHaveLength(4);
  expect(at(0, -0.5), "floor").toBeDefined();
  expect(at(-36, 8), "left wall").toBeDefined();
  expect(at(36, 8), "right wall").toBeDefined();
  expect(at(0, 20.5), "ceiling underside 20").toBeDefined();
  // The climb ladder / overhangs are gone.
  expect(at(-22, 2.5), "left low step removed").toBeUndefined();
  expect(at(22, 2.5), "right low step removed").toBeUndefined();
  expect(at(-29, 5.5), "left main ledge removed").toBeUndefined();
  expect(at(29, 5.5), "right main ledge removed").toBeUndefined();
  expect(at(-30, 10.5), "left overhang removed").toBeUndefined();
  expect(at(30, 10.5), "right overhang removed").toBeUndefined();
  // Bells lowered to contest height (6.0) with a larger scoring radius (1.0).
  const right = FLAT_DOJO.bells.find((b) => b.id === "right");
  expect(right?.hitZone.y).toBeCloseTo(6.0, 5);
  expect(right?.hitZone.x).toBeCloseTo(31, 5);
  expect(right?.hitZone.radius).toBeCloseTo(1.0, 5);
  // No climb ladder on the flat court.
  expect(FLAT_DOJO.botClimb).toBeUndefined();
});
