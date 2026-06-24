export interface BoxCollider {
  kind: "box";
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}
export interface RampCollider {
  kind: "ramp";
  /** World-space polygon vertices (absolute units), authored CCW. Built as a
   *  solid convex hull, so vertex order is collision-irrelevant; order only
   *  affects the renderer polygon fill. */
  points: [number, number][];
}
export type ColliderDef = BoxCollider | RampCollider;

// A circular Bell Hit-Zone (world units). Kept separate from the visible Bell art
// so scoring geometry and visuals can diverge (the art may be larger/offset).
export interface CircleZone {
  kind: "circle";
  x: number;
  y: number;
  radius: number;
}

// The visible Bell art shape (world units). Intentionally distinct from the
// Bell Hit-Zone — the render shell draws this; only the Bell Hit-Zone scores.
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

/**
 * Inner faces of the two side walls (world X). Authored alongside the wall
 * colliders so consumers (e.g. the practice bot's corner awareness) read a typed
 * value instead of scanning colliders. Not part of hashed sim state.
 */
export interface ArenaBounds {
  leftWallInnerX: number;
  rightWallInnerX: number;
}

export interface ArenaDef {
  id: string;
  colliders: ColliderDef[]; // inserted in array order (determinism contract)
  bells: BellDef[]; // tested in array order (determinism contract)
  /** Inner faces of the side walls (world X). Optional for legacy/test fixtures. */
  bounds?: ArenaBounds;
  /** Per-slot spawn points indexed by Player Slot id (0..3). */
  playerSpawns: { x: number; y: number }[];
  /** @deprecated Use playerSpawns[0] instead. Kept for compatibility. */
  playerSpawn: { x: number; y: number };
  ballSpawn: { x: number; y: number };
  /** Per-side x where each bay's ramp begins (for bot bay-detection). Optional. */
  bayRampBaseX?: { left: number; right: number };
}

/** The set of available arena ids. */
export type ArenaId = "flat-dojo" | "temple-ascent" | "twin-ledge";

// Flat Dojo (FLI-11): a flat open aerial-volley court. Wide flat floor, two side
// walls, and a high ceiling (underside ~20) that ricochets the floaty ball back
// into play. Two lowered Bells flank the arena at contest height (y=6.0). No
// climb ladder, ledges, or overhangs — contesting/ringing happens through jumps +
// aerial strikes. Mirror-symmetric about x=0. Authored in world units (X right, Y up).
export const FLAT_DOJO: ArenaDef = {
  id: "flat-dojo",
  // Side walls at x=±36, halfW 0.5 → inner faces at ∓35.5.
  bounds: { leftWallInnerX: -35.5, rightWallInnerX: 35.5 },
  colliders: [
    // floor: top surface at y = 0 (72 units wide)
    { kind: "box", x: 0, y: -0.5, halfW: 36, halfH: 0.5 },
    // left wall: inner face at x = -35.5, spans y 0→16
    { kind: "box", x: -36, y: 8, halfW: 0.5, halfH: 8 },
    // right wall: inner face at x = 35.5, spans y 0→16
    { kind: "box", x: 36, y: 8, halfW: 0.5, halfH: 8 },
    // ceiling: underside at y = 20, active ricochet surface for the floaty ball
    { kind: "box", x: 0, y: 20.5, halfW: 36, halfH: 0.5 },
  ],
  bells: [
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -31, y: 6.0, halfW: 0.7, halfH: 0.7 },
      hitZone: { kind: "circle", x: -31, y: 6.0, radius: 1.0 },
    },
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 31, y: 6.0, halfW: 0.7, halfH: 0.7 },
      hitZone: { kind: "circle", x: 31, y: 6.0, radius: 1.0 },
    },
  ],
  playerSpawns: [
    { x: -4, y: 1 }, // slot 0 — Team 0 (left)
    { x: -7, y: 1 }, // slot 1 — Team 0 (left)
    { x: 4, y: 1 }, // slot 2 — Team 1 (right)
    { x: 7, y: 1 }, // slot 3 — Team 1 (right)
  ],
  playerSpawn: { x: -4, y: 1 }, // deprecated alias for slot 0
  ballSpawn: { x: 0, y: 6.0 },
  // Flat Dojo is flat; the bot plays the air (Phase 4).
};

// Temple Ascent: ~92u-wide arena with a flat open center lane that ramps up into
// two mirrored end bays. Each bay has a Bell hanging high under a raised eave
// behind a mouth lip, sheltering it from top-down drops. Players run up the ramp
// to land on the elevated platform and contest with Jump/Strike under the eave.
// Mirror-symmetric about x=0. Authored in world units (X right, Y up).
export const TEMPLE_ASCENT: ArenaDef = {
  id: "temple-ascent",
  // Side walls at x=±46, halfW 0.5 → inner faces at ∓45.5.
  bounds: { leftWallInnerX: -45.5, rightWallInnerX: 45.5 },
  colliders: [
    // [0] flat center floor (x -30..+30)
    { kind: "box", x: 0, y: -0.5, halfW: 30, halfH: 0.5 },
    // [1] left wall: inner face at x = -45.5, top y17.5
    { kind: "box", x: -46, y: 8.5, halfW: 0.5, halfH: 9.0 },
    // [2] right wall: inner face at x = 45.5, top y17.5
    { kind: "box", x: 46, y: 8.5, halfW: 0.5, halfH: 9.0 },
    // [3] left slope+landing: ramp rises from x=-30,y=0 to landing at x=-43,y=4
    {
      kind: "ramp",
      points: [
        [-30, 0],
        [-45.5, 0],
        [-45.5, 4],
        [-43, 4],
      ],
    },
    // [4] right slope+landing (mirror)
    {
      kind: "ramp",
      points: [
        [30, 0],
        [45.5, 0],
        [45.5, 4],
        [43, 4],
      ],
    },
    // [5] left eave: underside y8.7 (x -37...-45.5)
    { kind: "box", x: -41.25, y: 9.1, halfW: 4.25, halfH: 0.4 },
    // [6] right eave (mirror)
    { kind: "box", x: 41.25, y: 9.1, halfW: 4.25, halfH: 0.4 },
    // [7] left mouth lip: hangs y7.3..8.7 at the bay mouth
    { kind: "box", x: -37.3, y: 8.0, halfW: 0.3, halfH: 0.7 },
    // [8] right mouth lip (mirror)
    { kind: "box", x: 37.3, y: 8.0, halfW: 0.3, halfH: 0.7 },
    // [9] ceiling: underside y17.5
    { kind: "box", x: 0, y: 17.5, halfW: 46, halfH: 0.5 },
  ],
  bells: [
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -43, y: 6.3, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -43, y: 6.3, radius: 1.0 },
    },
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 43, y: 6.3, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 43, y: 6.3, radius: 1.0 },
    },
  ],
  playerSpawns: [
    { x: -4, y: 1 }, // slot 0 — Team 0 (left)
    { x: -8, y: 1 }, // slot 1 — Team 0 (left)
    { x: 4, y: 1 }, // slot 2 — Team 1 (right)
    { x: 8, y: 1 }, // slot 3 — Team 1 (right)
  ],
  playerSpawn: { x: -4, y: 1 },
  ballSpawn: { x: 0, y: 6 },
  // The ramp is a run-up, not a staged ladder; the bot reads it via bayRampBaseX.
  bayRampBaseX: { left: -30, right: 30 },
};

// Twin Ledge: 96-unit-wide open floor with stepped symmetric side ledges (a
// low inner step and a wide outer main ledge) for platforming up to the bells.
// Mirror-symmetric about x=0.
export const TWIN_LEDGE: ArenaDef = {
  id: "twin-ledge",
  // Side walls at x=±48, halfW 0.5 → inner faces at ∓47.5.
  bounds: { leftWallInnerX: -47.5, rightWallInnerX: 47.5 },
  colliders: [
    // floor (96 units wide)
    { kind: "box", x: 0, y: -0.5, halfW: 48, halfH: 0.5 },
    // left wall: inner face at x = -47.5
    { kind: "box", x: -48, y: 5, halfW: 0.5, halfH: 6 },
    // right wall: inner face at x = 47.5
    { kind: "box", x: 48, y: 5, halfW: 0.5, halfH: 6 },
    // inner ledge pair: low stepping platforms
    { kind: "box", x: -16, y: 2.5, halfW: 4, halfH: 0.5 },
    { kind: "box", x: 16, y: 2.5, halfW: 4, halfH: 0.5 },
    // outer ledge pair: wide main platforms near the bells
    { kind: "box", x: -34, y: 4, halfW: 5, halfH: 0.5 },
    { kind: "box", x: 34, y: 4, halfW: 5, halfH: 0.5 },
    // ceiling
    { kind: "box", x: 0, y: 11.5, halfW: 48, halfH: 0.5 },
  ],
  bells: [
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -40, y: 6, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -40, y: 6, radius: 0.8 },
    },
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 40, y: 6, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 40, y: 6, radius: 0.8 },
    },
  ],
  playerSpawns: [
    { x: -4, y: 1 }, // slot 0 — Team 0 (left)
    { x: -7, y: 1 }, // slot 1 — Team 0 (left)
    { x: 4, y: 1 }, // slot 2 — Team 1 (right)
    { x: 7, y: 1 }, // slot 3 — Team 1 (right)
  ],
  playerSpawn: { x: -4, y: 1 },
  ballSpawn: { x: 0, y: 6 },
};

/** Registry of all available arenas, keyed by ArenaId (plus back-compat alias). */
export const ARENAS: Record<string, ArenaDef> = {
  "flat-dojo": FLAT_DOJO,
  "temple-ascent": TEMPLE_ASCENT,
  "pillared-temple": TEMPLE_ASCENT, // back-compat alias (old replays/manifests)
  "twin-ledge": TWIN_LEDGE,
};

/** Resolve an arena by id, falling back to FLAT_DOJO for unknown ids. */
export const resolveArena = (id: string): ArenaDef =>
  ARENAS[id as ArenaId] ?? FLAT_DOJO;
