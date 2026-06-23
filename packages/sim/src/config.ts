export const SIM_CONFIG_VERSION = 7;

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
  headerUpwardBias: number; // extra +Y for an airborne neutral/up header
  spikeMultiplier: number; // multiplies magnitude for a downward spike
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

export interface MatchConfig {
  lengthTicks: number; // regulation length (default 5400 = 3:00 @ 30Hz)
  scoringPauseTicks: number; // freeze after a Bell Ring before reset
  resetTicks: number; // reset/respawn countdown before play resumes
  goldenGoal: boolean; // tie at regulation → sudden-death next ring wins
}

export interface CombatConfig {
  staggerThreshold: number; // stagger >= this → Knockdown
  staggerPerHit: number; // stagger added per connecting strike
  staggerDecayPerTick: number; // stagger removed each live tick once grace expires
  staggerGraceTicks: number; // ticks after a hit during which stagger does NOT decay
  knockdownDurationTicks: number; // control-locked duration (~30–45 = 1.0–1.5s)
  recoveryInvulnTicks: number; // i-frames granted on stand-up
  strikePlayerImpulse: number; // knockback speed (units/s) applied to vx/vy
  playerHitRadius: number; // target body radius for the overlap test
}

export interface SimConfig {
  tickHz: number; // 30 — authoritative fixed step
  gravityY: number; // negative (−Y) per coordinate invariant
  ball: BallConfig;
  player: { halfW: number; halfH: number };
  movement: MovementConfig;
  dash: DashConfig;
  strike: StrikeConfig;
  match: MatchConfig;
  combat: CombatConfig;
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
    jumpSpeed: 12, // FLI-9 tall redesign: feet apex ≈ 3.6u so a single jump lands a low ledge
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
    headerUpwardBias: 1.2,
    spikeMultiplier: 1.6,
  },
  match: {
    lengthTicks: 5400, // 3:00 @ 30 Hz
    scoringPauseTicks: 45, // ~1.5s celebration freeze
    resetTicks: 30, // ~1.0s respawn settle
    goldenGoal: true,
  },
  combat: {
    staggerThreshold: 3,
    staggerPerHit: 1,
    staggerDecayPerTick: 0.05, // ~1.5/s bleed-off once the grace window lapses
    staggerGraceTicks: 45, // 1.5s hold after a hit → 3 hits in an exchange reliably KD
    knockdownDurationTicks: 36, // 1.2s @ 30Hz
    recoveryInvulnTicks: 30, // 1.0s i-frames
    strikePlayerImpulse: 9,
    playerHitRadius: 0.6,
  },
};
