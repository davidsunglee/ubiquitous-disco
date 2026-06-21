/**
 * correctionConfig — Phase 3
 *
 * Dev-tunable thresholds for the client-side prediction correction loop.
 * Exposed via `hudBridge` in Phase 4 so the network simulator sliders can
 * tune the feel during testing.
 *
 * smooth below `snapThreshold` world units: blend toward the corrected position
 * over `smoothFactor` (0=instant, 1=no blend).
 * snap above `snapThreshold`: teleport directly to the corrected position.
 */

import { INTERP_DELAY_TICKS } from "./config";

export interface CorrectionConfig {
  /**
   * Distance (world units) above which a correction is snapped immediately
   * instead of smoothed. Large errors caused by misprediction are snapped
   * so the display doesn't visibly "slide" across the arena.
   *
   * Default: 1.5 world units (~72px at 48 px/unit).
   */
  snapThreshold: number;

  /**
   * Smooth-correction blend factor per render frame. The displayed position
   * moves `smoothFactor` of the way toward the corrected position each frame.
   * 1.0 = instant snap (effectively disables smoothing).
   * 0.3 = move 30% of the remaining error each frame.
   *
   * Default: 0.3 (roughly matches a 60Hz visual convergence in ~5 frames).
   */
  smoothFactor: number;

  /**
   * Interpolation delay for the remote player rendering (ticks behind
   * authoritative time). Must match `INTERP_DELAY_TICKS` from config.ts.
   *
   * Default: 3 (≈100ms at 30Hz).
   */
  interpDelayTicks: number;
}

export const DEFAULT_CORRECTION_CONFIG: CorrectionConfig = {
  snapThreshold: 1.5,
  smoothFactor: 0.3,
  // Single source of truth in config.ts — never hardcode the literal here.
  interpDelayTicks: INTERP_DELAY_TICKS,
};
