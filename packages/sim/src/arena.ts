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
  ballSpawn: { x: number; y: number };
}

// Flat Dojo (minimal this phase): a ground slab and a ball spawn above it.
export const FLAT_DOJO: ArenaDef = {
  id: "flat-dojo",
  colliders: [{ kind: "box", x: 0, y: -0.5, halfW: 10, halfH: 0.5 }],
  ballSpawn: { x: 0, y: 5 },
};
