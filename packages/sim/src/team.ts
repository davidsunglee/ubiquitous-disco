/**
 * Shared slot/team vocabulary for the four-Player-Slot / two-Team model.
 *
 * Kept here (in @bb/sim) rather than @bb/protocol so that:
 *  - @bb/sim can import it directly (no circular dep).
 *  - @bb/protocol re-exports it (protocol already depends on sim).
 *  - Apps (server, web) get it from whichever package they already import.
 */

export type PlayerSlotId = 0 | 1 | 2 | 3;
export type TeamId = 0 | 1;

export const TEAM_0_SLOTS = [0, 1] as const;
export const TEAM_1_SLOTS = [2, 3] as const;

/**
 * Team 0 = slots 0/1 (left side), Team 1 = slots 2/3 (right side).
 * The single source of truth for the slot→team mapping.
 */
export const teamForPlayerSlot = (slotId: PlayerSlotId): TeamId =>
  slotId < 2 ? 0 : 1;

/**
 * Per-slot last-acked seq, indexed by PlayerSlotId (0–3).
 * Bot slots and unused slots carry 0.
 */
export type AckBySlot = [number, number, number, number];
