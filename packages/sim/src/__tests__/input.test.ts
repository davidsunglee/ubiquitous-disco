import { expect, test } from "vitest";
import { deriveEdges, type HeldState, normalizeMove } from "../input";

test("normalizeMove leaves in-disc vectors unchanged", () => {
  expect(normalizeMove(0, 0)).toEqual({ moveX: 0, moveY: 0 });
  expect(normalizeMove(1, 0)).toEqual({ moveX: 1, moveY: 0 });
  expect(normalizeMove(0.5, 0)).toEqual({ moveX: 0.5, moveY: 0 });
});

test("normalizeMove clamps diagonals to the unit disc", () => {
  const { moveX, moveY } = normalizeMove(1, 1);
  expect(Math.hypot(moveX, moveY)).toBeCloseTo(1, 10);
  expect(moveX).toBeCloseTo(Math.SQRT1_2, 10);
  expect(moveY).toBeCloseTo(Math.SQRT1_2, 10);
});

test("normalizeMove preserves direction when clamping", () => {
  const { moveX, moveY } = normalizeMove(3, 4); // length 5
  expect(moveX).toBeCloseTo(0.6, 10);
  expect(moveY).toBeCloseTo(0.8, 10);
});

const held = (
  jump: boolean,
  dash: boolean,
  strike: boolean,
  special = false,
): HeldState => ({
  jump,
  dash,
  strike,
  special,
});

test("deriveEdges reports pressed on a rising edge only", () => {
  expect(
    deriveEdges(held(false, false, false), held(true, false, false)),
  ).toMatchObject({ jumpPressed: true });
  // still held → no new press
  expect(
    deriveEdges(held(true, false, false), held(true, false, false)),
  ).toMatchObject({ jumpPressed: false });
});

test("deriveEdges reports strikeReleased on a falling edge only", () => {
  expect(
    deriveEdges(held(false, false, true), held(false, false, false)),
  ).toMatchObject({ strikeReleased: true, strikePressed: false });
  expect(
    deriveEdges(held(false, false, false), held(false, false, false)),
  ).toMatchObject({ strikeReleased: false });
});

test("deriveEdges derives dash + strike pressed independently", () => {
  const edges = deriveEdges(held(false, false, false), held(false, true, true));
  expect(edges).toEqual({
    jumpPressed: false,
    dashPressed: true,
    strikePressed: true,
    strikeReleased: false,
    specialPressed: false,
  });
});

// Phase 2 (FLI-9): specialPressed edge derivation
test("deriveEdges reports specialPressed on a rising edge only", () => {
  // Rising edge: special not held → special held
  expect(
    deriveEdges(
      held(false, false, false, false),
      held(false, false, false, true),
    ),
  ).toMatchObject({ specialPressed: true });
  // Still held → no new press
  expect(
    deriveEdges(
      held(false, false, false, true),
      held(false, false, false, true),
    ),
  ).toMatchObject({ specialPressed: false });
  // Released → not pressed
  expect(
    deriveEdges(
      held(false, false, false, true),
      held(false, false, false, false),
    ),
  ).toMatchObject({ specialPressed: false });
});
