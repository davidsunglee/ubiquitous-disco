// ── Shared types ──────────────────────────────────────────────────────────────

// Re-export the canonical slot/team vocabulary from @bb/sim so that
// server and web can import from either package without a circular dep.
export type { AckBySlot, CharacterId, PlayerSlotId, TeamId } from "@bb/sim";
export {
  CHARACTERS,
  TEAM_0_SLOTS,
  TEAM_1_SLOTS,
  teamForPlayerSlot,
} from "@bb/sim";

/** @deprecated Use PlayerSlotId. Retained during the 1v1→2v2 migration. */
export type Slot = import("@bb/sim").PlayerSlotId;

// ── Room lifecycle messages (Phase 1) ─────────────────────────────────────────

export interface RoomReady {
  type: "RoomReady";
  slot: import("@bb/sim").PlayerSlotId;
  full: boolean;
  /**
   * The match's active Player Slots (mode template): 1v1 = [0, 2],
   * 2v2 = [0, 1, 2, 3]. The client builds its prediction sim + remote set
   * from this so it always matches the server.
   */
  slots: import("@bb/sim").PlayerSlotId[];
  /** Per-slot character id (indexed by PlayerSlotId) so prediction matches the server. */
  characters: import("@bb/sim").CharacterId[];
  /** Arena id for this match — client resolves the arena for its prediction sim + renderer. */
  arenaId: import("@bb/sim").ArenaId;
}

export interface RoomErrorMsg {
  type: "RoomError";
  code: string;
  message: string;
}

// ── Gameplay messages (Phase 2) ───────────────────────────────────────────────

import type { InputFrame, MatchState } from "@bb/sim";

/** One sequenced input frame (seq is monotonically increasing per client). */
export interface SeqInput {
  seq: number;
  input: InputFrame;
}

/**
 * Client → Server: current input + last ~3 unacked for reliability under
 * packet loss. `slot` is informational — the server uses session identity.
 */
export interface PlayerInput {
  type: "PlayerInput";
  slot: Slot;
  frames: SeqInput[]; // current frame first, then unacked tail (up to 3)
}

/** Server → Client: per-slot acknowledgement of the last consumed seq. */
export interface InputAck {
  type: "InputAck";
  lastAckedSeq: import("@bb/sim").AckBySlot; // index == PlayerSlotId
}

/**
 * Per-player authoritative state in a snapshot. Mirrors the actor + Rapier
 * kinematic position at the server's authoritative tick.
 */
export interface AuthPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  charge: number;
  knockdownTicks: number;
  invulnTicks: number;
}

/**
 * Server → Client: full authoritative world snapshot at 15 Hz.
 *
 * Phase-0 Decision 0b: ball MUST be restored via rapierBytesB64 (full Rapier
 * snapshot) because the lightweight pos/vel path drifts 3.55 world units after
 * wall contact (contact-solver warm-start impulses are not captured). The server
 * always sends rapierBytesB64; client applies it via restoreSnapshot().
 *
 * Kinematic players are still captured via lightweight AuthPlayer fields (they
 * are faithfully described by position alone). The rapierBytes restore then
 * syncs the Rapier world (including the dynamic ball) and we overwrite kinematic
 * player positions from AuthPlayer for determinism.
 */
export interface WorldSnapshot {
  type: "WorldSnapshot";
  serverTick: number;
  players: AuthPlayer[];
  ball: { x: number; y: number; vx: number; vy: number };
  /** Base64-encoded Rapier world snapshot (rw.takeSnapshot()). Always present. */
  rapierBytesB64: string;
  match: MatchState;
  lastAckedSeq: import("@bb/sim").AckBySlot; // index == PlayerSlotId; bot slots carry 0
}

// ── Disconnect + telemetry messages (Phase 5) ────────────────────────────────

/**
 * Server → Client: the match has ended due to a peer disconnect, server
 * shutdown, or an expired reconnect grace window. Clients should show a
 * fail-closed banner and stop accepting input.
 *
 * `reconnect-expired`: a disconnected human's grace window lapsed before they
 * could reclaim their Player Slot — the match is ended for all clients.
 */
export interface MatchClosed {
  type: "MatchClosed";
  reason: "peer-left" | "server-shutdown" | "reconnect-expired";
}

/**
 * Server → Client (optional): basic telemetry sampled from the server's
 * perspective. Clients may also derive RTT from `room.ping()`.
 */
export interface Telemetry {
  type: "Telemetry";
  /** Round-trip time in milliseconds (from room.ping()). */
  rtt: number;
  /** Difference between current server seq and last acked seq for this client. */
  ackLag: number;
}

// grows in later phases
export type ServerMessage =
  | RoomReady
  | RoomErrorMsg
  | InputAck
  | WorldSnapshot
  | MatchClosed
  | Telemetry;
export type ClientMessage = PlayerInput;

// ── (De)serializers ───────────────────────────────────────────────────────────

export const serializeRoomReady = (m: RoomReady): string => JSON.stringify(m);
export const deserializeRoomReady = (s: string): RoomReady =>
  JSON.parse(s) as RoomReady;

export const serializePlayerInput = (m: PlayerInput): string =>
  JSON.stringify(m);
export const deserializePlayerInput = (s: string): PlayerInput =>
  JSON.parse(s) as PlayerInput;

export const serializeInputAck = (m: InputAck): string => JSON.stringify(m);
export const deserializeInputAck = (s: string): InputAck =>
  JSON.parse(s) as InputAck;

export const serializeWorldSnapshot = (m: WorldSnapshot): string =>
  JSON.stringify(m);
export const deserializeWorldSnapshot = (s: string): WorldSnapshot =>
  JSON.parse(s) as WorldSnapshot;

export const serializeMatchClosed = (m: MatchClosed): string =>
  JSON.stringify(m);
export const deserializeMatchClosed = (s: string): MatchClosed =>
  JSON.parse(s) as MatchClosed;

export const serializeTelemetry = (m: Telemetry): string => JSON.stringify(m);
export const deserializeTelemetry = (s: string): Telemetry =>
  JSON.parse(s) as Telemetry;
