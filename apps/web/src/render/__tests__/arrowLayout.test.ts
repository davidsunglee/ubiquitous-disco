/**
 * Off-screen arrow layout tests (Phase 5, FLI-9).
 *
 * Pure logic — no Phaser — covering the per-team number mapping, side
 * classification, slot-ascending sort, and vertical stacking.
 */

import { expect, test } from "vitest";
import {
  type ArrowSubject,
  computeOffscreenArrows,
  playerNumberForSlot,
} from "../arrowLayout";

const VIEWPORT = { width: 960, height: 540 };
const OPTS = { edgeGap: 2, stackSpacing: 44 };

// Helper: a player at a given viewport position.
const at = (slot: number, vx: number, vy: number): ArrowSubject => ({
  slot,
  team: slot < 2 ? 0 : 1,
  vx,
  vy,
});

// ── Per-team number mapping ─────────────────────────────────────────────────

test("playerNumberForSlot maps slots to per-team player numbers", () => {
  expect(playerNumberForSlot(0)).toBe(1); // left team, player 1
  expect(playerNumberForSlot(1)).toBe(2); // left team, player 2
  expect(playerNumberForSlot(2)).toBe(1); // right team, player 1
  expect(playerNumberForSlot(3)).toBe(2); // right team, player 2
});

// ── Off-screen detection ────────────────────────────────────────────────────

test("on-screen players get no arrow", () => {
  const arrows = computeOffscreenArrows(
    [at(0, 480, 270), at(2, 500, 280)],
    VIEWPORT,
    OPTS,
  );
  expect(arrows).toHaveLength(0);
});

test("a player off the left edge gets a left arrow; off the right gets a right arrow", () => {
  const arrows = computeOffscreenArrows(
    [at(0, -50, 270), at(2, 1100, 270)],
    VIEWPORT,
    OPTS,
  );
  expect(arrows).toHaveLength(2);
  const left = arrows.find((a) => a.slot === 0);
  const right = arrows.find((a) => a.slot === 2);
  expect(left?.side).toBe("left");
  expect(left?.x).toBe(OPTS.edgeGap);
  expect(right?.side).toBe("right");
  expect(right?.x).toBe(VIEWPORT.width - OPTS.edgeGap);
});

test("a player off the top but in the left half pins to the left edge", () => {
  const arrows = computeOffscreenArrows([at(1, 200, -80)], VIEWPORT, OPTS);
  expect(arrows).toHaveLength(1);
  expect(arrows[0]?.side).toBe("left");
});

// ── Single arrow sits at the vertical mid-line ──────────────────────────────

test("a single off-screen player's arrow is centred at 50% height", () => {
  const arrows = computeOffscreenArrows([at(0, -50, 100)], VIEWPORT, OPTS);
  expect(arrows[0]?.y).toBeCloseTo(VIEWPORT.height / 2, 5);
});

// ── Stacking + sort order on the same side ──────────────────────────────────

test("all four players off the same side stack in slot order (T1P1,T1P2,T2P1,T2P2)", () => {
  const arrows = computeOffscreenArrows(
    [at(3, -10, 90), at(1, -20, 500), at(2, -30, 80), at(0, -40, 300)],
    VIEWPORT,
    OPTS,
  );
  expect(arrows).toHaveLength(4);
  // All on the left side, sorted by slot ascending.
  expect(arrows.map((a) => a.slot)).toEqual([0, 1, 2, 3]);
  expect(arrows.map((a) => a.number)).toEqual([1, 2, 1, 2]);
  expect(arrows.every((a) => a.side === "left")).toBe(true);

  // Strictly increasing y (stacked top → bottom), centred on mid-line.
  const ys = arrows.map((a) => a.y);
  for (let i = 1; i < ys.length; i++) {
    expect(ys[i]).toBeGreaterThan(ys[i - 1] ?? 0);
  }
  const mid = (ys[0]! + ys[3]!) / 2;
  expect(mid).toBeCloseTo(VIEWPORT.height / 2, 5);
  // Spacing matches the configured value.
  expect(ys[1]! - ys[0]!).toBeCloseTo(OPTS.stackSpacing, 5);
});

test("players split across both sides stack independently", () => {
  const arrows = computeOffscreenArrows(
    [at(0, -10, 200), at(1, -10, 400), at(2, 1000, 200), at(3, 1000, 400)],
    VIEWPORT,
    OPTS,
  );
  const leftYs = arrows.filter((a) => a.side === "left").map((a) => a.y);
  const rightYs = arrows.filter((a) => a.side === "right").map((a) => a.y);
  expect(leftYs).toHaveLength(2);
  expect(rightYs).toHaveLength(2);
  // Each side centres its own stack on the mid-line.
  expect((leftYs[0]! + leftYs[1]!) / 2).toBeCloseTo(VIEWPORT.height / 2, 5);
  expect((rightYs[0]! + rightYs[1]!) / 2).toBeCloseTo(VIEWPORT.height / 2, 5);
});
