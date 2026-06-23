export const SIM_CONFIG_VERSION = 8;

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

export interface OvertimeConfig {
  rampIntervalTicks: number; // ticks between hit-zone growth steps (default 900 = 30s)
  rampStepRadius: number; // world-unit radius added per step (default 0.4)
  rampMaxBonus: number; // hard cap on total added radius (default 1.6)
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
  overtime: OvertimeConfig;
}

export const DEFAULT_CONFIG: SimConfig = {
  tickHz: 30,
  gravityY: -20,
  ball: {
    radius: 0.38,
    restitution: 0.82,
    linearDamping: 0.1,
    gravityScale: 0.32, // FLI-11: effective gravity ≈ −6.4 u/s² — much floatier; tune up to 0.38–0.42 later
    mass: 0.35, // lighter → impulses hit harder
    maxSpeed: 22,
    playerPush: 6,
  },
  player: { halfW: 0.4, halfH: 0.8 },
  movement: {
    moveSpeed: 7.2,
    jumpSpeed: 16.5, // FLI-11 floaty: feet apex ≈ 9.08u (gravityScale 0.75) — a single jump clears the y=6 Bell
    gravityScale: 0.75,
    jumpCutMultiplier: 0.65,
    coyoteTicks: 5,
  },
  dash: {
    distance: 2.4,
    cooldownTicks: 22,
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
  overtime: {
    rampIntervalTicks: 900, // 30s @ 30Hz
    rampStepRadius: 0.4,
    rampMaxBonus: 1.6,
  },
};
