/**
 * PrivateLobby Durable Object — via PartyServer.
 *
 * Owns ephemeral lobby state for one short code:
 *  - Balanced seat assignment: Host → slot 0; guests → slots 2, 1, 3
 *  - Presence tracking (WebSocket connect/close)
 *  - Per-connection session tokens
 *  - Broadcasts LobbyState to all connected clients on every change
 *
 * Host controls (seat moves, bot fill, settings, lock/launch) added in Phase 5.
 * Reconnect / host-transfer authority lands in Phase 6.
 *
 * Persistence (Deviation #3 decision): this DO keeps its lobby state in
 * in-memory Maps, NOT ctx.storage. partyserver does not hibernate by default
 * and the live WebSocket connections keep the DO resident for the lobby's
 * active lifetime, so in-memory is acceptable for these ephemeral lobbies (no
 * D1/KV; the lobby dies when empty). The MatchLaunch DO — which outlives any
 * connection — DOES persist; see MatchLaunch.ts.
 */

import type {
  MatchManifest,
  MatchManifestSlot,
  PlayerSlotId,
} from "@bb/protocol";
import {
  type LobbyCommand,
  type LobbyJoin,
  type LobbySettings,
  type LobbySlot,
  type LobbyState,
  MATCH_LENGTH_DEFAULT_TICKS,
  MATCH_LENGTH_MAX_TICKS,
  MATCH_LENGTH_MIN_TICKS,
  type MatchLaunch,
  serializeLobbyState,
  serializeMatchLaunch,
} from "@bb/protocol";
import { type Connection, getServerByName, Server } from "partyserver";
import type { MatchLaunch as MatchLaunchDO } from "./MatchLaunch";

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

/** All four Player Slots in canonical order. */
const ALL_SLOTS: readonly PlayerSlotId[] = [0, 1, 2, 3];

/** Default lobby settings. */
const DEFAULT_SETTINGS: LobbySettings = {
  mode: "2v2",
  matchLengthTicks: MATCH_LENGTH_DEFAULT_TICKS, // 3:00 @ 30 Hz
  arenaId: "flat-dojo",
};

/** Only the Flat Dojo arena exists today — the picker exposes just this. */
const AVAILABLE_ARENAS = ["flat-dojo"] as const;

interface Env {
  PrivateLobby: DurableObjectNamespace;
  MATCH_LAUNCH: DurableObjectNamespace<MatchLaunchDO>;
}

export class PrivateLobby extends Server<Env> {
  /** Seats indexed by slot id. Populated as players join. */
  private seats = new Map<PlayerSlotId, SeatState>();

  /** Slot ids filled with a Practice Bot (Host-controlled). */
  private bots = new Set<PlayerSlotId>();

  /** Host's playerId (first human to connect). */
  private hostPlayerId: string | null = null;

  /** Map from connection id → playerId for quick lookup on close. */
  private connToPlayer = new Map<string, string>();

  /** Map from playerId → slotId for reconnect-within-session. */
  private playerToSlot = new Map<string, PlayerSlotId>();

  /** Lobby settings (host-editable via LobbyCommand setSettings). */
  private settings: LobbySettings = { ...DEFAULT_SETTINGS };

  /** True once the lobby has been locked into a launch (no further mutation). */
  private locked = false;

  /** The most recent launch built by lock() (for unit test inspection). */
  private lastLaunch: {
    launchId: string;
    manifest: MatchManifest;
    tokenToSlot: Record<string, PlayerSlotId>;
  } | null = null;

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
    } else if (msg.type === "LobbyCommand") {
      void this.handleLobbyCommand(connection, msg as LobbyCommand);
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

  /**
   * Find the next unoccupied slot in SEAT_ORDER (a seat is occupied by a human
   * OR a bot). Returns null if all four are taken.
   */
  private nextOpenSlot(): PlayerSlotId | null {
    for (const slotId of SEAT_ORDER) {
      if (!this.seats.has(slotId) && !this.bots.has(slotId)) {
        return slotId;
      }
    }
    return null;
  }

  /** Whether the given player is the current Host. */
  private isHost(playerId: string | undefined): boolean {
    return playerId !== undefined && playerId === this.hostPlayerId;
  }

  // ── Host controls (Phase 5) ──────────────────────────────────────────────────

  /**
   * Handle a host-control command. Permissions:
   *  - fillBot / clearBot / setSettings / start: Host only.
   *  - moveOccupant: Host may move anyone; a non-host may only move THEMSELVES
   *    into an open seat.
   *
   * Mutations are rejected once the lobby is locked.
   */
  private async handleLobbyCommand(
    connection: Connection,
    cmd: LobbyCommand,
  ): Promise<void> {
    if (this.locked) return;
    const playerId = this.connToPlayer.get(connection.id);
    if (playerId === undefined) return;

    switch (cmd.cmd) {
      case "moveOccupant":
        this.moveOccupant(playerId, cmd.fromSlot, cmd.toSlot);
        break;
      case "fillBot":
        if (this.isHost(playerId)) this.fillBot(cmd.slotId);
        break;
      case "clearBot":
        if (this.isHost(playerId)) this.clearBot(cmd.slotId);
        break;
      case "setSettings":
        if (this.isHost(playerId)) this.applySettings(cmd.settings);
        break;
      case "start":
        if (this.isHost(playerId)) await this.lock();
        break;
    }
  }

  /** Move a seat occupant (human) from one slot to an open slot. */
  private moveOccupant(
    requesterId: string,
    fromSlot: PlayerSlotId,
    toSlot: PlayerSlotId,
  ): void {
    const seat = this.seats.get(fromSlot);
    if (!seat) return; // nothing (or a bot) in the source seat
    // A non-host may only move themselves.
    if (!this.isHost(requesterId) && seat.playerId !== requesterId) return;
    // Destination must be entirely open (no human, no bot).
    if (this.seats.has(toSlot) || this.bots.has(toSlot)) return;

    this.seats.delete(fromSlot);
    seat.slotId = toSlot;
    this.seats.set(toSlot, seat);
    this.playerToSlot.set(seat.playerId, toSlot);
    this.sendLobbyStateToAll();
  }

  /** Fill an open seat with a Practice Bot. */
  private fillBot(slotId: PlayerSlotId): void {
    if (this.seats.has(slotId) || this.bots.has(slotId)) return;
    this.bots.add(slotId);
    this.sendLobbyStateToAll();
  }

  /** Clear a bot from a seat. */
  private clearBot(slotId: PlayerSlotId): void {
    if (!this.bots.has(slotId)) return;
    this.bots.delete(slotId);
    this.sendLobbyStateToAll();
  }

  /** Apply a partial settings patch (clamping match length to the legal range). */
  private applySettings(patch: Partial<LobbySettings>): void {
    if (patch.mode === "1v1" || patch.mode === "2v2") {
      this.settings.mode = patch.mode;
    }
    if (typeof patch.matchLengthTicks === "number") {
      this.settings.matchLengthTicks = Math.max(
        MATCH_LENGTH_MIN_TICKS,
        Math.min(MATCH_LENGTH_MAX_TICKS, Math.round(patch.matchLengthTicks)),
      );
    }
    if (
      patch.arenaId !== undefined &&
      (AVAILABLE_ARENAS as readonly string[]).includes(patch.arenaId)
    ) {
      this.settings.arenaId = patch.arenaId;
    }
    this.sendLobbyStateToAll();
  }

  /**
   * Lock the lobby into an immutable launch. Mints an opaque launchId + a
   * per-human single-use joinToken, writes the frozen manifest into the
   * MatchLaunch DO via DO→DO RPC, and delivers each human their own
   * MatchLaunch payload over their WebSocket.
   */
  private async lock(): Promise<void> {
    if (this.locked) return;
    // Require at least one occupant.
    if (this.seats.size === 0) return;
    this.locked = true;

    const launchId = crypto.randomUUID().replace(/-/g, "");

    // Build the manifest slots from current humans + bots.
    const manifestSlots: MatchManifestSlot[] = [];
    const tokenToSlot: Record<string, PlayerSlotId> = {};
    const launchByPlayer = new Map<string, MatchLaunch>();

    for (const slotId of ALL_SLOTS) {
      const seat = this.seats.get(slotId);
      if (seat) {
        manifestSlots.push({ slotId, kind: "human", playerId: seat.playerId });
        const joinToken = crypto.randomUUID().replace(/-/g, "");
        tokenToSlot[joinToken] = slotId;
        launchByPlayer.set(seat.playerId, {
          type: "MatchLaunch",
          launchId,
          playerSlotId: slotId,
          joinToken,
        });
      } else if (this.bots.has(slotId)) {
        manifestSlots.push({ slotId, kind: "bot" });
      }
    }

    const manifest: MatchManifest = {
      launchId,
      slots: manifestSlots,
      settings: { ...this.settings },
    };

    this.lastLaunch = { launchId, manifest, tokenToSlot };

    // Write the immutable manifest into the MatchLaunch DO (DO→DO RPC).
    const stub = await getServerByName(this.env.MATCH_LAUNCH, launchId);
    await stub.put({ manifest, tokenToSlot });

    // Deliver each human their own launch payload.
    for (const [pid, slotId] of this.playerToSlot) {
      const launch = launchByPlayer.get(pid);
      const seat = this.seats.get(slotId);
      if (!launch || !seat?.connId) continue;
      const conn = this.getConnection(seat.connId);
      conn?.send(serializeMatchLaunch(launch));
    }
  }

  /** Build the serialised LobbyState and broadcast it to all connected clients. */
  private sendLobbyStateToAll(): void {
    const msg = this.buildSerializedLobbyState();
    // Use partyserver's inherited broadcast() to send to all connections.
    this.broadcast(msg);
  }

  /** Build the JSON-serialised LobbyState. */
  private buildSerializedLobbyState(): string {
    const slots: LobbySlot[] = ALL_SLOTS.map((slotId) => {
      const seat = this.seats.get(slotId);
      if (seat) {
        return {
          slotId,
          occupant: {
            kind: "human" as const,
            playerId: seat.playerId,
            displayName: seat.displayName,
            present: seat.connId !== null,
          },
        };
      }
      if (this.bots.has(slotId)) {
        return { slotId, occupant: { kind: "bot" as const } };
      }
      return { slotId, occupant: null };
    });

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

  /** Whether a bot occupies the given slot (for unit test inspection). */
  hasBot(slotId: PlayerSlotId): boolean {
    return this.bots.has(slotId);
  }

  /** Current lobby settings (for unit test inspection). */
  get currentSettings(): LobbySettings {
    return this.settings;
  }

  /** Whether the lobby has been locked into a launch (for unit test inspection). */
  get isLocked(): boolean {
    return this.locked;
  }

  /** The most recent launch built by lock() (for unit test inspection). */
  get lastLaunchForTest(): {
    launchId: string;
    manifest: MatchManifest;
    tokenToSlot: Record<string, PlayerSlotId>;
  } | null {
    return this.lastLaunch;
  }

  /**
   * Drive a host command directly (for unit test inspection). Bypasses the
   * WebSocket transport; the connection is only used to resolve the caller's
   * playerId, so a minimal stub with the right `id` is sufficient.
   */
  testApplyCommand(connection: Connection, cmd: LobbyCommand): Promise<void> {
    return this.handleLobbyCommand(connection, cmd);
  }
}
