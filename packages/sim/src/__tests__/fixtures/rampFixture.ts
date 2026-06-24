import type { ArenaDef } from "../../arena";

// Compact (~24u) fixture with a solid ramp+landing on each side (mirror-symmetric).
// The right ramp's slope runs (3,0)→(9,3); the landing runs (9,3)→(11.5,3).
// Ball spawns at x=7 (slope surface y≈2) so it rolls down toward center.
export const RAMP_FIXTURE: ArenaDef = {
  id: "ramp-fixture",
  bounds: { leftWallInnerX: -11.5, rightWallInnerX: 11.5 },
  colliders: [
    { kind: "box", x: 0, y: -0.5, halfW: 12, halfH: 0.5 }, // floor
    { kind: "box", x: -12, y: 4, halfW: 0.5, halfH: 5 }, // left wall
    { kind: "box", x: 12, y: 4, halfW: 0.5, halfH: 5 }, // right wall
    {
      kind: "ramp",
      points: [
        [3, 0],
        [11.5, 0],
        [11.5, 3],
        [9, 3],
      ],
    }, // right slope+landing
    {
      kind: "ramp",
      points: [
        [-3, 0],
        [-11.5, 0],
        [-11.5, 3],
        [-9, 3],
      ],
    }, // left mirror
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
  ballSpawn: { x: 7, y: 4 },
};
