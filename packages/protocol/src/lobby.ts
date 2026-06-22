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

/**
 * Host-owned lobby controls (and the human "move to an open seat" action),
 * sent client → server over the lobby WebSocket. The PrivateLobby DO enforces
 * permissions: only the Host may fill/clear bots, change settings, move other
 * occupants, or start; any human may move themselves to an open seat.
 */
export type LobbyCommand =
  | {
      type: "LobbyCommand";
      cmd: "moveOccupant";
      fromSlot: PlayerSlotId;
      toSlot: PlayerSlotId;
    }
  | { type: "LobbyCommand"; cmd: "fillBot"; slotId: PlayerSlotId }
  | { type: "LobbyCommand"; cmd: "clearBot"; slotId: PlayerSlotId }
  | {
      type: "LobbyCommand";
      cmd: "setSettings";
      settings: Partial<LobbySettings>;
    }
  | { type: "LobbyCommand"; cmd: "start" };

// ── Launch handoff (Phase 5) ──────────────────────────────────────────────────

/** Match-length clamp range in sim ticks (2:00–5:00 @ 30 Hz). */
export const MATCH_LENGTH_MIN_TICKS = 3600;
export const MATCH_LENGTH_MAX_TICKS = 9000;
export const MATCH_LENGTH_DEFAULT_TICKS = 5400;

/** One slot in the immutable launch manifest (human or bot). */
export interface MatchManifestSlot {
  slotId: PlayerSlotId;
  kind: "human" | "bot";
  /** Present for human slots — the lobby playerId that owns this slot. */
  playerId?: string;
}

/**
 * The immutable, frozen description of a launched match. Written into the
 * MatchLaunch DO at lock() time and returned (without tokens) to the Colyseus
 * server on a successful claim. Carries no join tokens — those live alongside
 * the manifest in the MatchLaunch DO's storage, never exposed to clients.
 */
export interface MatchManifest {
  launchId: string;
  slots: MatchManifestSlot[];
  settings: LobbySettings;
}

/**
 * Server → client message delivered to each human when the Host starts the
 * match. Each human gets their OWN slot id + single-use join token.
 */
export interface MatchLaunch {
  type: "MatchLaunch";
  launchId: string;
  playerSlotId: PlayerSlotId;
  joinToken: string;
}

/** Colyseus → MatchLaunch DO: validate a join token. */
export interface ClaimRequest {
  joinToken: string;
}

/** MatchLaunch DO → Colyseus: claim result. */
export interface ClaimResponse {
  ok: boolean;
  playerSlotId?: PlayerSlotId;
  manifest?: MatchManifest;
}

// ── (De)serializers ───────────────────────────────────────────────────────────

export const serializeLobbyState = (m: LobbyState): string => JSON.stringify(m);
export const deserializeLobbyState = (s: string): LobbyState =>
  JSON.parse(s) as LobbyState;

export const serializeLobbyJoin = (m: LobbyJoin): string => JSON.stringify(m);
export const deserializeLobbyJoin = (s: string): LobbyJoin =>
  JSON.parse(s) as LobbyJoin;

export const serializeLobbyCommand = (m: LobbyCommand): string =>
  JSON.stringify(m);
export const deserializeLobbyCommand = (s: string): LobbyCommand =>
  JSON.parse(s) as LobbyCommand;

export const serializeMatchLaunch = (m: MatchLaunch): string =>
  JSON.stringify(m);
export const deserializeMatchLaunch = (s: string): MatchLaunch =>
  JSON.parse(s) as MatchLaunch;
