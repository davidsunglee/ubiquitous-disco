/**
 * Character module tests.
 *
 * Verifies:
 *  1. Registry completeness — all six CharacterIds present.
 *  2. Multiplier band — every multiplier within [0.80, 1.20].
 *  3. resolveCharacter math — correct scaling + Math.round on dashCooldown.
 *  4. Sifu identity — resolveCharacter(CHARACTERS.sifu, DEFAULT_CONFIG) equals
 *     the DEFAULT_CONFIG baseline values exactly.
 */

import { expect, test } from "vitest";
import {
  CHARACTERS,
  type CharacterId,
  DEFAULT_RESOLVED_CHARACTER,
  resolveCharacter,
} from "../character";
import { DEFAULT_CONFIG } from "../config";

// ── Registry completeness ─────────────────────────────────────────────────────

const EXPECTED_IDS: CharacterId[] = [
  "sifu",
  "vipra",
  "monkey-king",
  "old-master",
  "panda",
  "drunken-boxer",
];

test("CHARACTERS registry contains all six character ids", () => {
  const keys = Object.keys(CHARACTERS) as CharacterId[];
  for (const id of EXPECTED_IDS) {
    expect(keys).toContain(id);
  }
  expect(keys.length).toBe(EXPECTED_IDS.length);
});

test("each character has the correct id field matching its registry key", () => {
  for (const [key, def] of Object.entries(CHARACTERS)) {
    expect(def.id).toBe(key);
  }
});

// ── Multiplier band [0.80, 1.20] ─────────────────────────────────────────────

const BAND_MIN = 0.8;
const BAND_MAX = 1.2;

const STAT_KEYS = [
  "moveSpeed",
  "jumpSpeed",
  "dashDistance",
  "dashCooldown",
  "strikeImpulse",
  "strikeReach",
] as const;

for (const [id, def] of Object.entries(CHARACTERS)) {
  for (const key of STAT_KEYS) {
    const value = def.stats[key];
    test(`CHARACTERS.${id}.stats.${key} (${value}) is within [${BAND_MIN}, ${BAND_MAX}]`, () => {
      expect(value).toBeGreaterThanOrEqual(BAND_MIN);
      expect(value).toBeLessThanOrEqual(BAND_MAX);
    });
  }
}

// ── resolveCharacter math ─────────────────────────────────────────────────────

test("resolveCharacter scales moveSpeed by multiplier", () => {
  const def = CHARACTERS.vipra;
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  expect(rc.stats.moveSpeed).toBeCloseTo(
    DEFAULT_CONFIG.movement.moveSpeed * def.stats.moveSpeed,
  );
});

test("resolveCharacter scales jumpSpeed by multiplier", () => {
  const def = CHARACTERS["old-master"];
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  expect(rc.stats.jumpSpeed).toBeCloseTo(
    DEFAULT_CONFIG.movement.jumpSpeed * def.stats.jumpSpeed,
  );
});

test("resolveCharacter rounds dashCooldown to nearest integer", () => {
  // Vipra has dashCooldown multiplier 0.85; 18 * 0.85 = 15.3 → Math.round → 15.
  const def = CHARACTERS.vipra;
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  const expected = Math.round(
    DEFAULT_CONFIG.dash.cooldownTicks * def.stats.dashCooldown,
  );
  expect(rc.stats.dashCooldown).toBe(expected);
  expect(Number.isInteger(rc.stats.dashCooldown)).toBe(true);
});

test("resolveCharacter scales strikeMinImpulse and strikeMaxImpulse", () => {
  const def = CHARACTERS.panda;
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  expect(rc.stats.strikeMinImpulse).toBeCloseTo(
    DEFAULT_CONFIG.strike.minImpulse * def.stats.strikeImpulse,
  );
  expect(rc.stats.strikeMaxImpulse).toBeCloseTo(
    DEFAULT_CONFIG.strike.maxImpulse * def.stats.strikeImpulse,
  );
});

test("resolveCharacter scales strikeReach", () => {
  const def = CHARACTERS["old-master"];
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  expect(rc.stats.strikeReach).toBeCloseTo(
    DEFAULT_CONFIG.strike.reach * def.stats.strikeReach,
  );
});

test("resolveCharacter preserves airJumps and special", () => {
  const def = CHARACTERS["monkey-king"];
  const rc = resolveCharacter(def, DEFAULT_CONFIG);
  expect(rc.airJumps).toBe(1);
  expect(rc.special.kind).toBe("cloud-dash");
});

// ── Sifu identity ─────────────────────────────────────────────────────────────

test("resolveCharacter(CHARACTERS.sifu, DEFAULT_CONFIG) equals DEFAULT_CONFIG baseline", () => {
  const rc = resolveCharacter(CHARACTERS.sifu, DEFAULT_CONFIG);
  const s = rc.stats;

  // All Sifu multipliers are 1.0, so resolved == baseline.
  expect(s.moveSpeed).toBeCloseTo(DEFAULT_CONFIG.movement.moveSpeed); // 6
  expect(s.jumpSpeed).toBeCloseTo(DEFAULT_CONFIG.movement.jumpSpeed); // 11
  expect(s.dashDistance).toBeCloseTo(DEFAULT_CONFIG.dash.distance); // 3
  expect(s.dashCooldown).toBe(DEFAULT_CONFIG.dash.cooldownTicks); // 18 (integer)
  expect(s.strikeReach).toBeCloseTo(DEFAULT_CONFIG.strike.reach); // 2
  expect(s.strikeMinImpulse).toBeCloseTo(DEFAULT_CONFIG.strike.minImpulse); // 6
  expect(s.strikeMaxImpulse).toBeCloseTo(DEFAULT_CONFIG.strike.maxImpulse); // 16
});

test("DEFAULT_RESOLVED_CHARACTER equals resolveCharacter(sifu, DEFAULT_CONFIG)", () => {
  const rc = resolveCharacter(CHARACTERS.sifu, DEFAULT_CONFIG);
  expect(DEFAULT_RESOLVED_CHARACTER.id).toBe(rc.id);
  expect(DEFAULT_RESOLVED_CHARACTER.stats.moveSpeed).toBeCloseTo(
    rc.stats.moveSpeed,
  );
  expect(DEFAULT_RESOLVED_CHARACTER.stats.dashCooldown).toBe(
    rc.stats.dashCooldown,
  );
});

// ── Sifu is hash-neutral ──────────────────────────────────────────────────────

test("Sifu identity: all multipliers are exactly 1.0", () => {
  for (const key of STAT_KEYS) {
    expect(CHARACTERS.sifu.stats[key]).toBe(1.0);
  }
});
