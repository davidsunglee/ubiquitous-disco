export interface BoxCollider {
  kind: "box";
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
export type ColliderDef = BoxCollider;

export interface ArenaDef {
  id: string;
  colliders: ColliderDef[]; // inserted in array order (determinism contract)
  playerSpawn: { x: number; y: number };
  ballSpawn: { x: number; y: number };
}

// Flat Dojo: a flat floor, two side walls, and a low overhang/ledge the player
// can move under and bump into. Authored in world units (X right, Y up).
export const FLAT_DOJO: ArenaDef = {
  id: "flat-dojo",
  colliders: [
    // floor: top surface at y = 0
    { kind: "box", x: 0, y: -0.5, halfW: 12, halfH: 0.5 },
    // left wall: inner face at x = -11.5
    { kind: "box", x: -12, y: 4, halfW: 0.5, halfH: 5 },
    // right wall: inner face at x = 11.5
    { kind: "box", x: 12, y: 4, halfW: 0.5, halfH: 5 },
    // low overhang/ledge on the right side (underside at y = 3)
    { kind: "box", x: 8, y: 3.5, halfW: 2, halfH: 0.5 },
  ],
  playerSpawn: { x: -4, y: 1 },
  ballSpawn: { x: 0, y: 5 },
};
