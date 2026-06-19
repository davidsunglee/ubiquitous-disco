export const SIM_CONFIG_VERSION = 1;

export interface SimConfig {
  tickHz: number; // 30 — authoritative fixed step
  gravityY: number; // negative (−Y) per coordinate invariant
  ball: { radius: number; restitution: number; linearDamping: number };
}

export const DEFAULT_CONFIG: SimConfig = {
  tickHz: 30,
  gravityY: -20,
  ball: { radius: 0.3, restitution: 0.6, linearDamping: 0.05 },
};
