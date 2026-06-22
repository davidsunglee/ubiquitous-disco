/**
 * PrivateLobby Durable Object — via PartyServer.
 *
 * Owns ephemeral lobby state for one short code:
 *  - Balanced seat assignment: Host → slot 0; guests → slots 2, 1, 3
 *  - Presence tracking (WebSocket connect/close)
 *  - Per-connection session tokens
 *  - Broadcasts LobbyState to all connected clients on every change
 *
 * Host controls (seat moves, bot fill, settings, lock/launch) land in Phase 5.
 * Reconnect / host-transfer authority lands in Phase 6.
 */

import type { PlayerSlotId } from "@bb/protocol";
import {
  type LobbyJoin,
  type LobbySettings,
  type LobbySlot,
  type LobbyState,
  serializeLobbyState,
} from "@bb/protocol";
import { type Connection, Server } from "partyserver";

// Balanced seat assignment order:
// Slot 0 = Team 0 (Host), slot 2 = Team 1, slot 1 = Team 0, slot 3 = Team 1
const SEAT_ORDER: readonly PlayerSlotId[] = [0, 2, 1, 3];

/** State persisted per seat, keyed by slot id. */
interface SeatState {
  slotId: PlayerSlotId;
  playerId: string;
  displayName: string;
  /** WebSocket connection id, present when the player is currently connected. */
  connId: string | null;
}

/** Default lobby settings (Phase 4 only — settings controls come in Phase 5). */
const DEFAULT_SETTINGS: LobbySettings = {
  mode: "2v2",
  matchLengthTicks: 5400, // 3:00 @ 30 Hz
  arenaId: "flat-dojo",
};

interface Env {
  PrivateLobby: DurableObjectNamespace;
}

export class PrivateLobby extends Server<Env> {
  /** Seats indexed by slot id. Populated as players join. */
  private seats = new Map<PlayerSlotId, SeatState>();

  /** Host's playerId (first human to connect). */
  private hostPlayerId: string | null = null;

  /** Map from connection id → playerId for quick lookup on close. */
  private connToPlayer = new Map<string, string>();

  /** Map from playerId → slotId for reconnect-within-session. */
  private playerToSlot = new Map<string, PlayerSlotId>();

  /** Lobby settings (Phase 4: read-only default; Phase 5: host-editable). */
  private settings: LobbySettings = { ...DEFAULT_SETTINGS };

  /**
   * Called when a new WebSocket connection is established.
   *
   * The client sends a LobbyJoin message as the first WebSocket message
   * identifying their playerId and displayName. We reserve a seat immediately
   * (using the balanced order) and broadcast updated LobbyState.
   */
  onConnect(_connection: Connection): void {
    // Nothing to do here — we wait for the LobbyJoin message from the client.
    // This avoids a race where we'd need to parse the URL query string for
    // profile data. The client sends LobbyJoin immediately after connect.
  }

  onMessage(connection: Connection, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const msg = parsed as { type?: string };
    if (msg.type === "LobbyJoin") {
      this.handleLobbyJoin(connection, msg as LobbyJoin);
    }
  }

  onClose(connection: Connection): void {
    const playerId = this.connToPlayer.get(connection.id);
    if (!playerId) return;

    this.connToPlayer.delete(connection.id);

    // Mark the player as absent (keep their seat — they may reconnect).
    const slotId = this.playerToSlot.get(playerId);
    if (slotId !== undefined) {
      const seat = this.seats.get(slotId);
      if (seat) {
        seat.connId = null;
        this.sendLobbyStateToAll();
      }
    }
  }

  onError(connection: Connection): void {
    this.onClose(connection);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private handleLobbyJoin(connection: Connection, msg: LobbyJoin): void {
    const { playerId, displayName } = msg;

    // Register this connection.
    this.connToPlayer.set(connection.id, playerId);

    // If this player already has a seat (reconnecting within the same DO
    // lifetime), just update their connection id and presence.
    const existingSlot = this.playerToSlot.get(playerId);
    if (existingSlot !== undefined) {
      const seat = this.seats.get(existingSlot);
      if (seat) {
        seat.connId = connection.id;
        seat.displayName = displayName; // allow display name update
        this.sendLobbyStateToAll();
        return;
      }
    }

    // Assign the next open seat in balanced order.
    const slotId = this.nextOpenSlot();
    if (slotId === null) {
      // Lobby is full — close the connection.
      connection.close(1008, "lobby-full");
      return;
    }

    // If this is the first human, they become Host.
    if (this.hostPlayerId === null) {
      this.hostPlayerId = playerId;
    }

    const seat: SeatState = {
      slotId,
      playerId,
      displayName,
      connId: connection.id,
    };
    this.seats.set(slotId, seat);
    this.playerToSlot.set(playerId, slotId);

    // Broadcast updated state to all clients (including the new one).
    this.sendLobbyStateToAll();
  }

  /** Find the next unoccupied slot in SEAT_ORDER. Returns null if all four are taken. */
  private nextOpenSlot(): PlayerSlotId | null {
    for (const slotId of SEAT_ORDER) {
      if (!this.seats.has(slotId)) {
        return slotId;
      }
    }
    return null;
  }

  /** Build the serialised LobbyState and broadcast it to all connected clients. */
  private sendLobbyStateToAll(): void {
    const msg = this.buildSerializedLobbyState();
    // Use partyserver's inherited broadcast() to send to all connections.
    this.broadcast(msg);
  }

  /** Build the JSON-serialised LobbyState. */
  private buildSerializedLobbyState(): string {
    const slots: LobbySlot[] = ([0, 1, 2, 3] as PlayerSlotId[]).map(
      (slotId) => {
        const seat = this.seats.get(slotId);
        if (!seat) {
          return { slotId, occupant: null };
        }
        return {
          slotId,
          occupant: {
            kind: "human" as const,
            playerId: seat.playerId,
            displayName: seat.displayName,
            present: seat.connId !== null,
          },
        };
      },
    );

    const state: LobbyState = {
      type: "LobbyState",
      code: this.name ?? "",
      hostPlayerId: this.hostPlayerId ?? "",
      slots,
      settings: this.settings,
    };

    return serializeLobbyState(state);
  }

  // ── Test inspection surface (used by unit tests via runInDurableObject) ──────

  /** Number of occupied seats. */
  get seatCount(): number {
    return this.seats.size;
  }

  /** Seat state for a given slot id (for unit test inspection). */
  seatFor(slotId: PlayerSlotId): SeatState | undefined {
    return this.seats.get(slotId);
  }

  /** Slot assigned to a given playerId (for unit test inspection). */
  slotForPlayer(playerId: string): PlayerSlotId | undefined {
    return this.playerToSlot.get(playerId);
  }

  /** Current host player id (for unit test inspection). */
  get currentHostPlayerId(): string | null {
    return this.hostPlayerId;
  }
}
