export const SIM_CONFIG_VERSION = 6;

export interface MovementConfig {
  moveSpeed: number; // world units / second of horizontal movement
  jumpSpeed: number; // upward velocity (units/s) imparted on Jump
  gravityScale: number; // multiplies SimConfig.gravityY for the player actor
  jumpCutMultiplier: number; // [0,1] — upward velocity retained when Jump released early
  coyoteTicks: number; // grace ticks after leaving ground where Jump still works
}

export interface DashConfig {
  distance: number; // world units translated instantly on a Tele-Dash
  cooldownTicks: number; // ticks before another (grounded) Dash is allowed
}

export interface StrikeConfig {
  minChargeTicks: number; // a tap Strike counts as this many charge ticks
  maxChargeTicks: number; // charge clamps here (full charge)
  minImpulse: number; // impulse magnitude at min charge (tap)
  maxImpulse: number; // impulse magnitude at full charge
  upwardBias: number; // baseline +Y added to the strike direction (the "pop")
  reach: number; // max distance (world units) from player to ball to connect
}

export interface BallConfig {
  radius: number;
  restitution: number;
  linearDamping: number;
  gravityScale: number; // multiplies SimConfig.gravityY for the ball body
  mass: number; // ball mass in sim units (impulse is scaled against this)
  maxSpeed: number; // linear-velocity clamp (units/s)
  playerPush: number; // light player-body contact push speed (units/s)
}

export interface SimConfig {
  tickHz: number; // 30 — authoritative fixed step
  gravityY: number; // negative (−Y) per coordinate invariant
  ball: BallConfig;
  player: { halfW: number; halfH: number };
  movement: MovementConfig;
  dash: DashConfig;
  strike: StrikeConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  tickHz: 30,
  gravityY: -20,
  ball: {
    radius: 0.3,
    restitution: 0.6,
    linearDamping: 0.05,
    gravityScale: 1,
    mass: 0.5,
    maxSpeed: 30,
    playerPush: 4,
  },
  player: { halfW: 0.4, halfH: 0.8 },
  movement: {
    moveSpeed: 6,
    jumpSpeed: 11,
    gravityScale: 1,
    jumpCutMultiplier: 0.4,
    coyoteTicks: 4,
  },
  dash: {
    distance: 3,
    cooldownTicks: 18,
  },
  strike: {
    minChargeTicks: 1,
    maxChargeTicks: 24,
    minImpulse: 6,
    maxImpulse: 16,
    upwardBias: 0.5,
    reach: 2,
  },
};
