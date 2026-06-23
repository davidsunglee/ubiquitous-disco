import type { ArenaDef } from "../../arena";

/**
 * Compact test fixture arena (pre-Phase-5 Flat Dojo geometry: ~24 units wide,
 * walls at x=±11.5, bells at x=±9). Phase 5 scaled the production arenas to
 * 72–96 units wide, which puts bells/walls far beyond a single Strike's reach.
 *
 * Logic tests that exercise close-range ball↔bell and ball↔wall interactions
 * (bell-ring detection, scoring/own-goal attribution, golden goal, CCD wall
 * tunneling) use this fixture so their historically-tuned strike trajectories
 * still land, decoupled from the production arena scale.
 */
export const COMPACT_DOJO: ArenaDef = {
  id: "compact-dojo",
  colliders: [
    { kind: "box", x: 0, y: -0.5, halfW: 12, halfH: 0.5 }, // floor
    { kind: "box", x: -12, y: 4, halfW: 0.5, halfH: 5 }, // left wall (inner -11.5)
    { kind: "box", x: 12, y: 4, halfW: 0.5, halfH: 5 }, // right wall (inner 11.5)
    { kind: "box", x: 8, y: 3.5, halfW: 2, halfH: 0.5 }, // right overhang/ledge
    { kind: "box", x: 0, y: 9.5, halfW: 12, halfH: 0.5 }, // ceiling
  ],
  bells: [
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -9, y: 5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -9, y: 5, radius: 0.8 },
    },
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 9, y: 5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 9, y: 5, radius: 0.8 },
    },
  ],
  playerSpawns: [
    { x: -4, y: 1 },
    { x: -7, y: 1 },
    { x: 4, y: 1 },
    { x: 7, y: 1 },
  ],
  playerSpawn: { x: -4, y: 1 },
  ballSpawn: { x: 0, y: 5 },
};
