export const SIM_CONFIG_VERSION = 2;

export interface MovementConfig {
  moveSpeed: number; // world units / second of horizontal movement
  jumpSpeed: number; // upward velocity (units/s) imparted on Jump
  gravityScale: number; // multiplies SimConfig.gravityY for the player actor
  jumpCutMultiplier: number; // [0,1] — upward velocity retained when Jump released early
  coyoteTicks: number; // grace ticks after leaving ground where Jump still works
}

export interface SimConfig {
  tickHz: number; // 30 — authoritative fixed step
  gravityY: number; // negative (−Y) per coordinate invariant
  ball: { radius: number; restitution: number; linearDamping: number };
  player: { halfW: number; halfH: number };
  movement: MovementConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  tickHz: 30,
  gravityY: -20,
  ball: { radius: 0.3, restitution: 0.6, linearDamping: 0.05 },
  player: { halfW: 0.4, halfH: 0.8 },
  movement: {
    moveSpeed: 6,
    jumpSpeed: 11,
    gravityScale: 1,
    jumpCutMultiplier: 0.4,
    coyoteTicks: 4,
  },
};
