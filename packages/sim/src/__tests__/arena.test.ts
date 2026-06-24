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
  DUNE_BASIN,
  FLAT_DOJO,
  resolveArena,
  TEMPLE_ASCENT,
} from "../arena";
import { testArenaMirrorSymmetry } from "./helpers/arenaSymmetry";

const ARENA_IDS: ArenaId[] = ["flat-dojo", "temple-ascent", "dune-basin"];

// ── Registry completeness ──────────────────────────────────────────────────────

test("ARENAS registry contains all three ArenaId keys", () => {
  for (const id of ARENA_IDS) {
    expect(ARENAS).toHaveProperty(id);
    expect(ARENAS[id]).toBeDefined();
  }
});

test("ARENAS exposes the three canonical ids plus the pillared-temple alias", () => {
  for (const id of ARENA_IDS) expect(ARENAS).toHaveProperty(id);
  // Alias preserves old replays/manifests instead of falling back to Flat Dojo.
  expect(resolveArena("pillared-temple")).toBe(TEMPLE_ASCENT);
});

test("ARENAS keys match the arena def ids", () => {
  for (const id of ARENA_IDS) {
    expect(ARENAS[id]?.id).toBe(id);
  }
});

test("FLAT_DOJO, TEMPLE_ASCENT, DUNE_BASIN are exported and match registry", () => {
  expect(ARENAS["flat-dojo"]).toBe(FLAT_DOJO);
  expect(ARENAS["temple-ascent"]).toBe(TEMPLE_ASCENT);
  expect(ARENAS["dune-basin"]).toBe(DUNE_BASIN);
});

// ── resolveArena ──────────────────────────────────────────────────────────────

test("resolveArena returns the correct arena for known ids", () => {
  expect(resolveArena("flat-dojo")).toBe(FLAT_DOJO);
  expect(resolveArena("temple-ascent")).toBe(TEMPLE_ASCENT);
  expect(resolveArena("dune-basin")).toBe(DUNE_BASIN);
});

test("resolveArena falls back to FLAT_DOJO for unknown ids", () => {
  expect(resolveArena("unknown-arena")).toBe(FLAT_DOJO);
  expect(resolveArena("")).toBe(FLAT_DOJO);
});

// ── Per-arena property tests ───────────────────────────────────────────────────

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
    // The widest collider is always a box (floor/ceiling). Ramps carry no halfW.
    // Arenas are authored large (72–96u) so the adaptive camera engages and play feels big.
    const boxHalfWs = arena.colliders
      .filter((c) => c.kind === "box")
      .map((c) => c.halfW);
    const width = 2 * Math.max(...boxHalfWs);
    expect(width, `[${id}] width must be ≥ 72`).toBeGreaterThanOrEqual(72);
    expect(width, `[${id}] width must be ≤ 96`).toBeLessThanOrEqual(96);
  });
}

// ── FLAT_DOJO-specific: flat open court (FLI-11) ──────────────────────────────

test("FLAT_DOJO is the flat open court: 4 colliders, high ceiling, low bells, no climb", () => {
  const at = (x: number, y: number) =>
    FLAT_DOJO.colliders.find(
      (c) =>
        c.kind === "box" &&
        Math.abs(c.x - x) < 0.01 &&
        Math.abs(c.y - y) < 0.01,
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
});

// ── DUNE_BASIN-specific: dune ridges + side Bell chambers (FLI-13) ─────────────

test("DUNE_BASIN is a basin + dune ridges + side chambers, with no suspended ledges", () => {
  const boxAt = (x: number, y: number) =>
    DUNE_BASIN.colliders.find(
      (c) =>
        c.kind === "box" &&
        Math.abs(c.x - x) < 0.01 &&
        Math.abs(c.y - y) < 0.01,
    );

  // Two dune ridges authored as ramps (one per side), descending to basin level.
  const ramps = DUNE_BASIN.colliders.filter((c) => c.kind === "ramp");
  expect(ramps, "two dune ridges").toHaveLength(2);

  // Each chamber has a floor (top y=0) under its Bell near x = ±44.
  expect(boxAt(-43, -0.5), "left chamber floor").toBeDefined();
  expect(boxAt(43, -0.5), "right chamber floor").toBeDefined();
  const leftBell = DUNE_BASIN.bells.find((b) => b.id === "left");
  const rightBell = DUNE_BASIN.bells.find((b) => b.id === "right");
  expect(leftBell?.hitZone.x).toBeCloseTo(-44, 5);
  expect(rightBell?.hitZone.x).toBeCloseTo(44, 5);
  expect(leftBell?.hitZone.radius).toBeCloseTo(1.0, 5);
  // Bell sits inside the chamber floor's x-span (x -47.5..-38.5 / 38.5..47.5).
  expect(leftBell?.hitZone.x).toBeGreaterThan(-47.5);
  expect(leftBell?.hitZone.x).toBeLessThan(-38.5);
  expect(rightBell?.hitZone.x).toBeGreaterThan(38.5);
  expect(rightBell?.hitZone.x).toBeLessThan(47.5);

  // The old Twin Ledge suspended stepping ledges (x = ±16 / ±34) are gone.
  expect(boxAt(-16, 2.5), "old left inner ledge removed").toBeUndefined();
  expect(boxAt(16, 2.5), "old right inner ledge removed").toBeUndefined();
  expect(boxAt(-34, 4), "old left outer ledge removed").toBeUndefined();
  expect(boxAt(34, 4), "old right outer ledge removed").toBeUndefined();

  // Ramp-and-pocket arena: the bot reads the basin exit, with no climb data.
  expect(DUNE_BASIN.bayRampBaseX).toEqual({ left: -15, right: 15 });
});
