export interface BoxCollider {
  kind: "box";
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
export type ColliderDef = BoxCollider;

// A circular Bell hit-zone (world units). Kept separate from the visible Bell art
// so scoring geometry and visuals can diverge (the art may be larger/offset).
export interface CircleZone {
  kind: "circle";
  x: number;
  y: number;
  radius: number;
}

// The visible Bell art shape (world units). Intentionally distinct from the
// hit-zone — the render shell draws this; only the hit-zone scores.
export interface BoxArt {
  kind: "box";
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
export type ArtShape = BoxArt;

export interface BellDef {
  id: "left" | "right";
  // Which side this Bell defends (informational for later phases / overlays).
  defends: "left" | "right";
  art: ArtShape; // drawn by the render shell
  hitZone: CircleZone; // pure-geometric Bell Ring detection target
}

export interface ArenaDef {
  id: string;
  colliders: ColliderDef[]; // inserted in array order (determinism contract)
  bells: BellDef[]; // tested in array order (determinism contract)
  playerSpawn: { x: number; y: number };
  ballSpawn: { x: number; y: number };
}

// Flat Dojo: a flat floor, two side walls, and a low overhang/ledge the player
// can move under and bump into. Two elevated Bells flank the arena. Authored in
// world units (X right, Y up).
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
  bells: [
    // Left Bell: elevated near the left wall, defends the left side.
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -9, y: 5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -9, y: 5, radius: 0.8 },
    },
    // Right Bell: elevated near the right wall (clear of the x=8 overhang),
    // defends the right side.
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 9, y: 5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 9, y: 5, radius: 0.8 },
    },
  ],
  playerSpawn: { x: -4, y: 1 },
  ballSpawn: { x: 0, y: 5 },
};
