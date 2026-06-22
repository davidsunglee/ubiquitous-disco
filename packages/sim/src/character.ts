import { DEFAULT_CONFIG, type SimConfig } from "./config";

export type CharacterId =
  | "sifu"
  | "vipra"
  | "monkey-king"
  | "old-master"
  | "panda"
  | "drunken-boxer";

export type SpecialKind =
  | "palm-burst"
  | "phantom-rush"
  | "cloud-dash"
  | "repulse-field"
  | "ground-pound"
  | "stagger-stumble"
  /** No Special: pressing the Special button is a no-op (no effect, no cooldown). */
  | "none";

/** Cooldown Special definition. `params` are placeholder tunables per kind. */
export interface SpecialDef {
  kind: SpecialKind;
  cooldownTicks: number;
  /** Placeholder tunables (impulse, radius, lunge distance, etc.). */
  params: Record<string, number>;
}

/** Multipliers over DEFAULT_CONFIG baseline. 1.0 = baseline. Band: [0.80, 1.20]. */
export interface CharacterStatDeltas {
  moveSpeed: number;
  jumpSpeed: number;
  dashDistance: number;
  dashCooldown: number; // <1.0 = faster recovery
  strikeImpulse: number; // scales both min and max strike impulse
  strikeReach: number;
}

export interface CharacterDef {
  id: CharacterId;
  displayName: string;
  stats: CharacterStatDeltas;
  special: SpecialDef;
  /** Extra mid-air jumps beyond the baseline single jump. Sifu/etc = 0. */
  airJumps: number;
}

/** Absolute (resolved) per-actor stats — baseline × multiplier, computed once per match. */
export interface ResolvedStats {
  moveSpeed: number;
  jumpSpeed: number;
  dashDistance: number;
  dashCooldown: number; // integer ticks
  strikeMinImpulse: number;
  strikeMaxImpulse: number;
  strikeReach: number;
}

export interface ResolvedCharacter {
  id: CharacterId;
  stats: ResolvedStats;
  special: SpecialDef;
  airJumps: number;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  sifu: {
    id: "sifu",
    displayName: "Sifu",
    airJumps: 0,
    stats: {
      moveSpeed: 1.0,
      jumpSpeed: 1.0,
      dashDistance: 1.0,
      dashCooldown: 1.0,
      strikeImpulse: 1.0,
      strikeReach: 1.0,
    },
    special: {
      kind: "palm-burst",
      cooldownTicks: 90,
      params: { impulse: 8, reach: 2.2 },
    },
  },
  vipra: {
    id: "vipra",
    displayName: "Vipra",
    airJumps: 0,
    stats: {
      moveSpeed: 1.18,
      jumpSpeed: 1.05,
      dashDistance: 1.15,
      dashCooldown: 0.85,
      strikeImpulse: 0.88,
      strikeReach: 0.95,
    },
    special: {
      kind: "phantom-rush",
      cooldownTicks: 120,
      params: { distance: 8, stagger: 1 },
    },
  },
  "monkey-king": {
    id: "monkey-king",
    displayName: "Monkey King",
    airJumps: 1,
    stats: {
      moveSpeed: 1.05,
      jumpSpeed: 1.12,
      dashDistance: 1.1,
      dashCooldown: 0.95,
      strikeImpulse: 0.92,
      strikeReach: 1.0,
    },
    // Special intentionally DISABLED (FLI-9 balance): Monkey King's extra air
    // jump is identity enough, so he carries no cooldown Special. The cloud-dash
    // implementation is retained in stepSpecial and can be reattached by setting
    // kind back to "cloud-dash".
    special: {
      kind: "none",
      cooldownTicks: 0,
      params: {},
    },
  },
  "old-master": {
    id: "old-master",
    displayName: "Old Master",
    airJumps: 0,
    stats: {
      moveSpeed: 0.85,
      jumpSpeed: 0.92,
      dashDistance: 0.9,
      dashCooldown: 1.15,
      strikeImpulse: 1.18,
      strikeReach: 1.2,
    },
    special: {
      kind: "repulse-field",
      cooldownTicks: 140,
      params: { radius: 3, impulse: 9 },
    },
  },
  panda: {
    id: "panda",
    displayName: "Panda",
    airJumps: 0,
    stats: {
      moveSpeed: 0.84,
      jumpSpeed: 0.9,
      dashDistance: 0.85,
      dashCooldown: 1.18,
      strikeImpulse: 1.2,
      strikeReach: 1.05,
    },
    special: {
      kind: "ground-pound",
      cooldownTicks: 130,
      params: { radius: 3, ballPunt: 14 },
    },
  },
  "drunken-boxer": {
    id: "drunken-boxer",
    displayName: "Drunken Boxer",
    airJumps: 0,
    stats: {
      moveSpeed: 1.02,
      jumpSpeed: 1.0,
      dashDistance: 1.05,
      dashCooldown: 0.92,
      strikeImpulse: 1.0,
      strikeReach: 1.1,
    },
    special: {
      kind: "stagger-stumble",
      cooldownTicks: 100,
      params: { lungeMax: 5 },
    },
  },
};

export function resolveCharacter(
  def: CharacterDef,
  config: SimConfig,
): ResolvedCharacter {
  const s = def.stats;
  return {
    id: def.id,
    special: def.special,
    airJumps: def.airJumps,
    stats: {
      moveSpeed: config.movement.moveSpeed * s.moveSpeed,
      jumpSpeed: config.movement.jumpSpeed * s.jumpSpeed,
      dashDistance: config.dash.distance * s.dashDistance,
      dashCooldown: Math.round(config.dash.cooldownTicks * s.dashCooldown),
      strikeMinImpulse: config.strike.minImpulse * s.strikeImpulse,
      strikeMaxImpulse: config.strike.maxImpulse * s.strikeImpulse,
      strikeReach: config.strike.reach * s.strikeReach,
    },
  };
}

/** Sifu @ DEFAULT_CONFIG — used as the legacy default so existing callers stay identical. */
export const DEFAULT_RESOLVED_CHARACTER = resolveCharacter(
  CHARACTERS.sifu,
  DEFAULT_CONFIG,
);
