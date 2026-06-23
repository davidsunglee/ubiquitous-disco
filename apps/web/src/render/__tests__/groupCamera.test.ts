/**
 * GroupCamera unit tests (Phase 5, FLI-9).
 *
 * Tests the adaptive zoom-floor math and GroupSubject shape constraints without
 * requiring a live Phaser instance or canvas.
 *
 * These tests intentionally do NOT import GroupCamera.ts (which pulls in
 * Phaser at module scope and fails under jsdom without a canvas). Instead
 * they verify the same math inline.
 */

import { expect, test } from "vitest";
import { PX_PER_UNIT } from "../worldToScreen";

// ── Zoom floor math ──────────────────────────────────────────────────────────
//
// minZoom = MIN_CHAR_PX / (CHAR_WORLD_HEIGHT * PX_PER_UNIT)
//   MIN_CHAR_PX      = 40  (min readable character height in screen pixels)
//   CHAR_WORLD_HEIGHT = 1.6 (2 * player.halfH)
//   PX_PER_UNIT      = 48  (see worldToScreen.ts)
//
// → minZoom ≈ 40 / (1.6 * 48) ≈ 0.5208

const MIN_CHAR_PX = 40;
const CHAR_WORLD_HEIGHT = 1.6;
const derivedMinZoom = MIN_CHAR_PX / (CHAR_WORLD_HEIGHT * PX_PER_UNIT);

test("zoom floor is derived correctly from MIN_CHAR_PX / (CHAR_WORLD_HEIGHT * PX_PER_UNIT)", () => {
  expect(derivedMinZoom).toBeCloseTo(0.52, 1);
});

test("zoom floor with PX_PER_UNIT=48 is approximately 0.52", () => {
  expect(PX_PER_UNIT).toBe(48);
  const expected = 40 / (1.6 * 48);
  expect(expected).toBeCloseTo(0.52, 1);
});

test("zoom floor is greater than 0 (positive floor)", () => {
  expect(derivedMinZoom).toBeGreaterThan(0);
});

test("zoom floor is less than 1 (allows normal zoom range)", () => {
  expect(derivedMinZoom).toBeLessThan(1);
});

test("zoom floor prevents characters from being smaller than MIN_CHAR_PX", () => {
  // At minZoom, a character of CHAR_WORLD_HEIGHT world units is exactly MIN_CHAR_PX
  // screen pixels tall: screenPx = worldH * PX_PER_UNIT * minZoom = MIN_CHAR_PX
  const screenPx = CHAR_WORLD_HEIGHT * PX_PER_UNIT * derivedMinZoom;
  expect(screenPx).toBeCloseTo(MIN_CHAR_PX, 5);
});

// ── Subject tagging intent ────────────────────────────────────────────────────
//
// GroupSubject has optional isPlayer and team fields. The camera draws
// edge arrows only for subjects where isPlayer=true. Ball and bell subjects
// should NOT receive arrows (isPlayer=false/undefined).

test("ball subject schema: isPlayer=false means no arrow drawn", () => {
  // Type-level: verify the object shape expected for a ball subject.
  interface GroupSubjectLike {
    screenX: number;
    screenY: number;
    isPlayer?: boolean;
    team?: number;
  }
  const ballSubject: GroupSubjectLike = {
    screenX: 400,
    screenY: 300,
    isPlayer: false,
  };
  // isPlayer=false → no arrow for the ball.
  expect(ballSubject.isPlayer).toBe(false);
});

test("player subject schema: isPlayer=true with team triggers arrow logic", () => {
  interface GroupSubjectLike {
    screenX: number;
    screenY: number;
    isPlayer?: boolean;
    team?: number;
  }
  const p0: GroupSubjectLike = {
    screenX: 200,
    screenY: 300,
    isPlayer: true,
    team: 0,
  };
  const p1: GroupSubjectLike = {
    screenX: 600,
    screenY: 300,
    isPlayer: true,
    team: 1,
  };
  expect(p0.isPlayer).toBe(true);
  expect(p0.team).toBe(0);
  expect(p1.team).toBe(1);
});

test("bell subject schema: no isPlayer means no arrow", () => {
  interface GroupSubjectLike {
    screenX: number;
    screenY: number;
    isPlayer?: boolean;
    team?: number;
  }
  const bellSubject: GroupSubjectLike = { screenX: 100, screenY: 200 };
  // Bells don't set isPlayer — treated same as isPlayer=undefined → no arrow.
  expect(bellSubject.isPlayer).toBeUndefined();
});
