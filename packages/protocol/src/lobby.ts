/**
 * Lobby protocol — typed JSON contracts for the Private Lobby coordination layer.
 *
 * Mirrors the messages.ts pattern: plain JSON interfaces + serialize/deserialize
 * round-trip helpers. Imported by apps/worker, apps/web, and apps/server.
 *
 * PlayerSlotId / teamForPlayerSlot re-exported from @bb/sim via @bb/protocol —
 * no teamId is stored on each LobbySlot (it is derived at read time).
 */

import type { PlayerSlotId } from "@bb/sim";

// ── Profile ───────────────────────────────────────────────────────────────────

/** A player's anonymous local profile (stored in localStorage by the web client). */
export interface LocalProfile {
  playerId: string;
  displayName: string;
}

// ── Lobby slot occupants ───────────────────────────────────────────────────────

export interface HumanOccupant {
  kind: "human";
  playerId: string;
  displayName: string;
  /** Whether the player's WebSocket connection is currently live. */
  present: boolean;
}

export interface BotOccupant {
  kind: "bot";
}

export type SlotOccupant = HumanOccupant | BotOccupant;

export interface LobbySlot {
  slotId: PlayerSlotId;
  occupant: SlotOccupant | null;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface LobbySettings {
  mode: "1v1" | "2v2";
  /** Match length in sim ticks (@ 30 Hz). Range [3600, 9000]; default 5400 = 3:00. */
  matchLengthTicks: number;
  arenaId: string;
}

// ── Server → client messages ──────────────────────────────────────────────────

/**
 * Broadcast from the PrivateLobby DO to all connected WebSocket clients
 * whenever lobby state changes (join, leave, seat move, settings update).
 */
export interface LobbyState {
  type: "LobbyState";
  code: string;
  hostPlayerId: string;
  slots: LobbySlot[];
  settings: LobbySettings;
}

// ── Client → server messages (sent as JSON over the WebSocket) ────────────────

/**
 * Sent by the connecting client as the first message after the WebSocket
 * handshake to identify themselves and claim a seat.
 */
export interface LobbyJoin {
  type: "LobbyJoin";
  playerId: string;
  displayName: string;
}

// ── (De)serializers ───────────────────────────────────────────────────────────

export const serializeLobbyState = (m: LobbyState): string => JSON.stringify(m);
export const deserializeLobbyState = (s: string): LobbyState =>
  JSON.parse(s) as LobbyState;

export const serializeLobbyJoin = (m: LobbyJoin): string => JSON.stringify(m);
export const deserializeLobbyJoin = (s: string): LobbyJoin =>
  JSON.parse(s) as LobbyJoin;
