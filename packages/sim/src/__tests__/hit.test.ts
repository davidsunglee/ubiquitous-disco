/**
 * applyHit — the shared Strike/Special hit tail (FLI-9 cleanup #10).
 *
 * The "attribute → accumulate stagger → refresh grace → maybe knockdown" tail
 * was inlined identically in five hit sites (strike + four Specials). These
 * tests pin the extracted helper's behaviour so all five stay in lock-step.
 */

import { describe, expect, test } from "vitest";
import { createActor } from "../actor";
import { DEFAULT_CONFIG } from "../config";
import { applyHit } from "../rules/hit";

describe("applyHit", () => {
  test("attributes the hit to the striker and accumulates stagger (below threshold)", () => {
    const target = createActor();
    applyHit(target, 2, DEFAULT_CONFIG);

    expect(target.lastHitBy).toBe(2);
    expect(target.stagger).toBe(DEFAULT_CONFIG.combat.staggerPerHit);
    expect(target.staggerDecayDelay).toBe(
      DEFAULT_CONFIG.combat.staggerGraceTicks,
    );
    // One hit is below the threshold → no knockdown.
    expect(target.knockdownTicks).toBe(0);
    expect(target.controlLock).toBe(false);
  });

  test("crossing the stagger threshold triggers a knockdown and resets stagger", () => {
    const target = createActor();
    const { staggerThreshold, staggerPerHit, knockdownDurationTicks } =
      DEFAULT_CONFIG.combat;
    // Pre-load stagger one hit short of the threshold.
    target.stagger = staggerThreshold - staggerPerHit;

    applyHit(target, 0, DEFAULT_CONFIG);

    expect(target.knockdownTicks).toBe(knockdownDurationTicks);
    expect(target.controlLock).toBe(true);
    expect(target.stagger).toBe(0); // reset on knockdown
    expect(target.lastHitBy).toBe(0);
  });
});
