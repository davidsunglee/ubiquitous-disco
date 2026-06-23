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

/** A platform top the bot stands on while climbing toward a bell. */
export interface ClimbWaypoint {
  x: number;
  surfaceY: number;
}
/** Per-side ordered climb paths (floor → … → bell column). */
export interface ArenaClimb {
  left: ClimbWaypoint[];
  right: ClimbWaypoint[];
}

export interface ArenaDef {
  id: string;
  colliders: ColliderDef[]; // inserted in array order (determinism contract)
  bells: BellDef[]; // tested in array order (determinism contract)
  /** Per-slot spawn points indexed by Player Slot id (0..3). */
  playerSpawns: { x: number; y: number }[];
  /** @deprecated Use playerSpawns[0] instead. Kept for compatibility. */
  playerSpawn: { x: number; y: number };
  ballSpawn: { x: number; y: number };
  /** Optional bot climb ladder per side (absent → bot uses ground+jump only). */
  botClimb?: ArenaClimb;
}

/** The set of available arena ids. */
export type ArenaId = "flat-dojo" | "pillared-temple" | "twin-ledge";

// Flat Dojo: a wide flat floor, two side walls, and a two-step platform ladder
// climbing to a bell tucked under an overhang. Two elevated Bells flank the arena.
// Authored in world units (X right, Y up).
// FLI-9 (tall redesign): 72 units wide × 16u tall. A two-step ladder (low step
// top 3.0, main ledge top 6.0) climbs to a bell at y=8.5 tucked under an
// overhang lip (underside 10). Mirror-symmetric about x=0.
export const FLAT_DOJO: ArenaDef = {
  id: "flat-dojo",
  colliders: [
    // floor: top surface at y = 0 (72 units wide)
    { kind: "box", x: 0, y: -0.5, halfW: 36, halfH: 0.5 },
    // left wall: inner face at x = -35.5, spans y 0→16
    { kind: "box", x: -36, y: 8, halfW: 0.5, halfH: 8 },
    // right wall: inner face at x = 35.5, spans y 0→16
    { kind: "box", x: 36, y: 8, halfW: 0.5, halfH: 8 },
    // LEFT low step (mirrored): top surface y = 3.0
    { kind: "box", x: -22, y: 2.5, halfW: 2.5, halfH: 0.5 },
    // RIGHT low step (mirrored): top surface y = 3.0
    { kind: "box", x: 22, y: 2.5, halfW: 2.5, halfH: 0.5 },
    // LEFT main ledge (mirrored): top surface y = 6.0
    { kind: "box", x: -29, y: 5.5, halfW: 3.0, halfH: 0.5 },
    // RIGHT main ledge (mirrored): top surface y = 6.0
    { kind: "box", x: 29, y: 5.5, halfW: 3.0, halfH: 0.5 },
    // LEFT overhang lip (mirrored): underside y = 10, caps the bell pocket
    { kind: "box", x: -30, y: 10.5, halfW: 4.5, halfH: 0.5 },
    // RIGHT overhang lip (mirrored): underside y = 10
    { kind: "box", x: 30, y: 10.5, halfW: 4.5, halfH: 0.5 },
    // ceiling: underside at y = 16, closes the box (ball CCD prevents tunnelling)
    { kind: "box", x: 0, y: 16.5, halfW: 36, halfH: 0.5 },
  ],
  bells: [
    // Left Bell: tucked in the overhang pocket, defends the left side.
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -31, y: 8.5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -31, y: 8.5, radius: 0.8 },
    },
    // Right Bell: tucked in the overhang pocket, defends the right side.
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 31, y: 8.5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 31, y: 8.5, radius: 0.8 },
    },
  ],
  playerSpawns: [
    // Teams face off near the centre ball, then push outward toward the bells.
    { x: -4, y: 1 }, // slot 0 — Team 0 (left)
    { x: -7, y: 1 }, // slot 1 — Team 0 (left)
    { x: 4, y: 1 }, // slot 2 — Team 1 (right)
    { x: 7, y: 1 }, // slot 3 — Team 1 (right)
  ],
  playerSpawn: { x: -4, y: 1 }, // deprecated alias for slot 0
  ballSpawn: { x: 0, y: 6 },
  botClimb: {
    left: [
      { x: -22, surfaceY: 3.0 },
      { x: -29, surfaceY: 6.0 },
    ],
    right: [
      { x: 22, surfaceY: 3.0 },
      { x: 29, surfaceY: 6.0 },
    ],
  },
};

// Pillared Temple: 84-unit-wide arena with two pairs of interior pillars
// creating lane structure. Mirror-symmetric about x=0. Bells set higher to
// reward aerial play.
export const PILLARED_TEMPLE: ArenaDef = {
  id: "pillared-temple",
  colliders: [
    // floor (84 units wide)
    { kind: "box", x: 0, y: -0.5, halfW: 42, halfH: 0.5 },
    // left wall: inner face at x = -41.5
    { kind: "box", x: -42, y: 5, halfW: 0.5, halfH: 6 },
    // right wall: inner face at x = 41.5
    { kind: "box", x: 42, y: 5, halfW: 0.5, halfH: 6 },
    // inner pillar pair: tall columns flanking centre
    { kind: "box", x: -12, y: 3, halfW: 0.6, halfH: 3 },
    { kind: "box", x: 12, y: 3, halfW: 0.6, halfH: 3 },
    // outer pillar pair: tall columns toward the bells
    { kind: "box", x: -28, y: 3, halfW: 0.6, halfH: 3 },
    { kind: "box", x: 28, y: 3, halfW: 0.6, halfH: 3 },
    // ceiling
    { kind: "box", x: 0, y: 11.5, halfW: 42, halfH: 0.5 },
  ],
  bells: [
    {
      id: "left",
      defends: "left",
      art: { kind: "box", x: -36, y: 6.5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: -36, y: 6.5, radius: 0.8 },
    },
    {
      id: "right",
      defends: "right",
      art: { kind: "box", x: 36, y: 6.5, halfW: 0.6, halfH: 0.6 },
      hitZone: { kind: "circle", x: 36, y: 6.5, radius: 0.8 },
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
};

// Twin Ledge: 96-unit-wide open floor with stepped symmetric side ledges (a
// low inner step and a wide outer main ledge) for platforming up to the bells.
// Mirror-symmetric about x=0.
export const TWIN_LEDGE: ArenaDef = {
  id: "twin-ledge",
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
  botClimb: {
    left: [
      { x: -16, surfaceY: 3.0 },
      { x: -34, surfaceY: 4.5 },
    ],
    right: [
      { x: 16, surfaceY: 3.0 },
      { x: 34, surfaceY: 4.5 },
    ],
  },
};

/** Registry of all available arenas, keyed by ArenaId. */
export const ARENAS: Record<ArenaId, ArenaDef> = {
  "flat-dojo": FLAT_DOJO,
  "pillared-temple": PILLARED_TEMPLE,
  "twin-ledge": TWIN_LEDGE,
};

/** Resolve an arena by id, falling back to FLAT_DOJO for unknown ids. */
export const resolveArena = (id: string): ArenaDef =>
  ARENAS[id as ArenaId] ?? FLAT_DOJO;
