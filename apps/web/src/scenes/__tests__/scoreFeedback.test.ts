import { describe, expect, test } from "vitest";
import { bellFromScoreDelta } from "../scoreFeedback";

describe("bellFromScoreDelta", () => {
  test("Team 0 scoring (scores[0]++) means the RIGHT bell rang", () => {
    expect(bellFromScoreDelta([0, 0], [1, 0])).toBe("right");
  });

  test("Team 1 scoring (scores[1]++) means the LEFT bell rang", () => {
    expect(bellFromScoreDelta([0, 0], [0, 1])).toBe("left");
  });

  test("no score change returns null", () => {
    expect(bellFromScoreDelta([2, 3], [2, 3])).toBeNull();
  });

  test("a decrease (e.g. rematch reset) returns null, not a bell", () => {
    expect(bellFromScoreDelta([2, 3], [0, 0])).toBeNull();
  });

  test("tolerates short/empty arrays (no previous state) without firing", () => {
    expect(bellFromScoreDelta([], [])).toBeNull();
    expect(bellFromScoreDelta([], [0, 0])).toBeNull();
  });

  test("first Bell Ring from an empty previous score array fires", () => {
    // prev unknown (length 0) but next shows team 0 at 1 — treat missing as 0.
    expect(bellFromScoreDelta([0], [1, 0])).toBe("right");
  });
});
