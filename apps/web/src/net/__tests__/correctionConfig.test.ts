/**
 * correctionConfig guard test (#10).
 *
 * The remote-player interpolation delay is defined once as INTERP_DELAY_TICKS
 * in config.ts. DEFAULT_CORRECTION_CONFIG.interpDelayTicks must track that
 * single source of truth so the two can never drift apart.
 */

import { expect, test } from "vitest";
import { INTERP_DELAY_TICKS } from "../config";
import { DEFAULT_CORRECTION_CONFIG } from "../correctionConfig";

test("DEFAULT_CORRECTION_CONFIG.interpDelayTicks tracks INTERP_DELAY_TICKS", () => {
  expect(DEFAULT_CORRECTION_CONFIG.interpDelayTicks).toBe(INTERP_DELAY_TICKS);
});
