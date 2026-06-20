/**
 * Developer replay format and helpers.
 *
 * A ReplayData captures everything needed to re-run a session deterministically:
 *  - seed: the random seed passed to createSimulation
 *  - simConfigVersion: the SIM_CONFIG_VERSION constant at capture time
 *  - arenaId: the arena's id string
 *  - rosterId: a string identifying the character roster (single character = 'default')
 *  - inputFrames: one row per tick; each row is [slot0Frame, slot1Frame, ...]
 *
 * playReplay() re-runs those rows through a fresh createSimulation() and returns
 * the final hashState(). Calling it twice with the same ReplayData must return the
 * same hash — and must equal the hash from the live capture session.
 */

import { FLAT_DOJO } from "./arena";
import { DEFAULT_CONFIG, SIM_CONFIG_VERSION } from "./config";
import type { InputFrame } from "./input";
import { createSimulation } from "./simulation";

export interface ReplayData {
  seed: number;
  simConfigVersion: number;
  arenaId: string;
  rosterId: string;
  /** One row per tick; each row is [slot0Frame, slot1Frame, ...]. */
  inputFrames: InputFrame[][];
}

/**
 * Record a single row of frames (one per slot) into a ReplayData.inputFrames
 * array (mutates the array). Call this each tick BEFORE stepping the sim,
 * using the same InputFrame[] you are about to pass to sim.step().
 */
export function recordFrame(replay: ReplayData, frames: InputFrame[]): void {
  replay.inputFrames.push(frames.map((f) => ({ ...f }))); // deep copy each frame
}

/**
 * Replay all inputFrames through a fresh simulation and return the final
 * hashState(). The arena and config are resolved from the replay metadata:
 *  - arenaId "flat-dojo" → FLAT_DOJO
 *  - config → DEFAULT_CONFIG (the only config supported this phase)
 *
 * Calling this function twice with the same ReplayData must produce the same hash.
 * If the replay was captured from a live session, the hash must equal the session's
 * final hashState() taken after all the same frames were stepped.
 */
export function playReplay(replay: ReplayData): string {
  // Resolve arena from id.
  if (replay.arenaId !== FLAT_DOJO.id) {
    throw new Error(
      `playReplay: unknown arenaId "${replay.arenaId}" — only "${FLAT_DOJO.id}" is supported`,
    );
  }

  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: replay.seed,
  });

  for (const row of replay.inputFrames) {
    sim.step(row);
  }

  return sim.hashState();
}

/**
 * Create an empty ReplayData ready to record into, using the current
 * SIM_CONFIG_VERSION and the given arena/roster/seed.
 */
export function createReplay(
  seed: number,
  arenaId: string = FLAT_DOJO.id,
  rosterId: string = "default",
): ReplayData {
  return {
    seed,
    simConfigVersion: SIM_CONFIG_VERSION,
    arenaId,
    rosterId,
    inputFrames: [],
  };
}

/**
 * Serialise a ReplayData to a JSON string (for download/save).
 */
export function serializeReplay(replay: ReplayData): string {
  return JSON.stringify(replay);
}

/**
 * Deserialise a ReplayData from a JSON string previously produced by
 * serializeReplay().
 */
export function deserializeReplay(json: string): ReplayData {
  return JSON.parse(json) as ReplayData;
}

// Re-export SIM_CONFIG_VERSION so callers can read it without importing config.
export { DEFAULT_CONFIG, SIM_CONFIG_VERSION };
