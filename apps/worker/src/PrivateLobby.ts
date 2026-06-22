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
 * Two-stage pre-launch presence expiry added as Phase 6 follow-up bug fix.
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
  DEFAULT_RECONNECT_CONFIG,
  type LobbyCommand,
  type LobbyJoin,
  type LobbyNotice,
  type LobbySettings,
  type LobbySlot,
  type LobbyState,
  MATCH_LENGTH_DEFAULT_TICKS,
  MATCH_LENGTH_MAX_TICKS,
  MATCH_LENGTH_MIN_TICKS,
  type MatchLaunch,
  serializeLobbyNotice,
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

/**
 * Player Slots required to be filled for each mode.
 * 2v2: all four slots; 1v1: slots 0 and 2 (one per Team).
 */
const REQUIRED_SLOTS: Record<"1v1" | "2v2", readonly PlayerSlotId[]> = {
  "1v1": [0, 2],
  "2v2": [0, 1, 2, 3],
};

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

  // ── Phase 6: two-stage pre-launch presence expiry ────────────────────────────

  /**
   * Tracks when each absent human disconnected (ms since epoch).
   * Keyed by playerId. An entry is added in onClose() and removed on
   * reconnect or after the seat is freed by alarm().
   *
   * Two deadlines are derived from this timestamp:
   *  - Stage 1 (hostTransferMs): if this player is the current host, transfer
   *    ownership to the next present human.
   *  - Stage 2 (seatExpiryMs): free the seat entirely so the slot is open.
   */
  private absentSince = new Map<string, number>();

  /**
   * Tracks which players have already had their host ownership transferred
   * (Stage 1 fired). Used to avoid re-triggering Stage 1 on repeated sweeps.
   */
  private hostTransferred = new Set<string>();

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
    let markedAbsent = false;
    const slotId = this.playerToSlot.get(playerId);
    if (slotId !== undefined) {
      const seat = this.seats.get(slotId);
      if (seat) {
        if (seat.connId !== connection.id) return;
        seat.connId = null;
        markedAbsent = true;
        this.sendLobbyStateToAll();
      }
    }

    // Phase 6 (two-stage): if the lobby is not locked, record when this
    // player went absent and schedule the next sweep alarm.
    if (!this.locked && markedAbsent) {
      this.absentSince.set(playerId, Date.now());
      this.hostTransferred.delete(playerId);
      this.scheduleNextAlarm();
    }
  }

  onError(connection: Connection): void {
    this.onClose(connection);
  }

  /**
   * Phase 6: two-stage presence-expiry alarm handler.
   *
   * Sweeps all absent players and fires any due deadline:
   *  - Stage 1 (hostTransferMs): transfer host ownership to the next present
   *    human if the absent player is still the current host.
   *  - Stage 2 (seatExpiryMs): free the seat entirely.
   *
   * After mutating state, calls scheduleNextAlarm() to re-arm for the next
   * pending deadline, or leaves the alarm cleared if none remain.
   *
   * Driven deterministically in tests via `runDurableObjectAlarm`.
   */
  async alarm(): Promise<void> {
    if (this.locked) return;

    const now = Date.now();
    const { hostTransferMs, seatExpiryMs } = DEFAULT_RECONNECT_CONFIG;
    let stateChanged = false;

    for (const [playerId, since] of this.absentSince) {
      const elapsed = now - since;

      // Stage 1: host transfer — only if this player is still the current
      // host and we haven't already transferred for this absence.
      if (
        elapsed >= hostTransferMs &&
        playerId === this.hostPlayerId &&
        !this.hostTransferred.has(playerId)
      ) {
        const newHost = this.nextPresentHost(playerId);
        if (newHost !== null) {
          this.hostTransferred.add(playerId);
          this.hostPlayerId = newHost;
          stateChanged = true;
        }
      }

      // Stage 2: seat expiry — free the seat if absent long enough.
      if (elapsed >= seatExpiryMs) {
        const slotId = this.playerToSlot.get(playerId);
        if (slotId !== undefined) {
          this.seats.delete(slotId);
          this.playerToSlot.delete(playerId);
        }
        this.absentSince.delete(playerId);
        this.hostTransferred.delete(playerId);

        // If the freed player was the current host, reassign to the next
        // present human in SEAT_ORDER, or null if nobody is present.
        if (playerId === this.hostPlayerId) {
          this.hostPlayerId = this.nextPresentHost(null);
        }
        stateChanged = true;
      }
    }

    if (stateChanged) {
      this.sendLobbyStateToAll();
    }

    // Re-arm for the next pending deadline.
    this.scheduleNextAlarm();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Compute the earliest pending alarm deadline across all absent seats and
   * call ctx.storage.setAlarm() for it. If no deadlines are pending, does
   * nothing (the alarm remains cleared or as previously scheduled).
   *
   * Called whenever absentSince changes (onClose, reconnect, after alarm sweep).
   */
  private scheduleNextAlarm(): void {
    if (this.locked || this.absentSince.size === 0) return;

    const { hostTransferMs, seatExpiryMs } = DEFAULT_RECONNECT_CONFIG;
    let earliest = Infinity;

    for (const [playerId, since] of this.absentSince) {
      // Stage 2 (always pending once absent).
      const expiry = since + seatExpiryMs;
      if (expiry < earliest) earliest = expiry;

      // Stage 1 (only if this player is the current host and not yet transferred).
      if (
        playerId === this.hostPlayerId &&
        !this.hostTransferred.has(playerId) &&
        this.nextPresentHost(playerId) !== null
      ) {
        const transfer = since + hostTransferMs;
        if (transfer < earliest) earliest = transfer;
      }
    }

    if (earliest !== Infinity) {
      void this.ctx.storage.setAlarm(earliest);
    }
  }

  /**
   * Return the playerId of the next present human in SEAT_ORDER, excluding
   * `excludePlayerId`. Returns null if none is present.
   */
  private nextPresentHost(excludePlayerId: string | null): string | null {
    for (const slotId of SEAT_ORDER) {
      const seat = this.seats.get(slotId);
      if (seat && seat.connId !== null && seat.playerId !== excludePlayerId) {
        return seat.playerId;
      }
    }
    return null;
  }

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

        // Phase 6: clear the absentSince entry so the expiry alarm doesn't
        // fire for this player. Re-schedule in case the earliest deadline
        // was theirs.
        this.absentSince.delete(playerId);
        this.hostTransferred.delete(playerId);
        this.scheduleNextAlarm();

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

    // A newly present human can satisfy an overdue no-target host-transfer.
    this.scheduleNextAlarm();

    // Broadcast updated state to all clients (including the new one).
    this.sendLobbyStateToAll();
  }

  /**
   * The set of slots seatable in the CURRENT mode, returned in the balanced
   * SEAT_ORDER. This is the single source of truth for mode→slots: 1v1 seats
   * only slots 0 and 2; 2v2 seats all four. nextOpenSlot(), fillBot(), and
   * lock() all route through this so capacity is consistently mode-aware.
   */
  private seatableSlots(): PlayerSlotId[] {
    const allowed = new Set<PlayerSlotId>(REQUIRED_SLOTS[this.settings.mode]);
    return SEAT_ORDER.filter((slotId) => allowed.has(slotId));
  }

  /**
   * Find the next unoccupied slot in SEAT_ORDER that belongs to the current
   * mode (a seat is occupied by a human OR a bot). Returns null when every
   * mode-seatable slot is taken (lobby is full for this mode).
   */
  private nextOpenSlot(): PlayerSlotId | null {
    for (const slotId of this.seatableSlots()) {
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
        if (this.isHost(playerId)) await this.lock(connection);
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

  /** Fill an open seat with a Practice Bot. Only mode-seatable slots qualify. */
  private fillBot(slotId: PlayerSlotId): void {
    if (this.seats.has(slotId) || this.bots.has(slotId)) return;
    // A bot may only occupy a slot that belongs to the current mode — e.g. in
    // 1v1, slots 1 and 3 are not seatable, so they can't be bot-filled.
    if (!this.seatableSlots().includes(slotId)) return;
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
   *
   * Guard conditions (either of these causes a rejection):
   *  1. Any seat holds an absent human (connId === null). That ghost slot can
   *     never be claimed, so the match can never start.
   *  2. A mode-required slot has no occupant at all (neither human nor bot).
   *
   * On guard failure, the lobby remains unlocked and the requesting host
   * connection receives a LobbyNotice with the reason.
   */
  private async lock(hostConnection?: Connection): Promise<void> {
    if (this.locked) return;
    // Require at least one occupant.
    if (this.seats.size === 0) return;

    // ── Guard: reject if any occupied seat is an absent human ──────────────
    for (const seat of this.seats.values()) {
      if (seat.connId === null) {
        if (hostConnection) {
          const notice: LobbyNotice = {
            type: "LobbyNotice",
            reason: "absent-human",
          };
          hostConnection.send(serializeLobbyNotice(notice));
        }
        return;
      }
    }

    // ── Guard: reject if any OCCUPIED slot is outside the current mode ─────
    // A host can switch mode (e.g. 2v2→1v1) after players are seated, leaving
    // humans/bots in slots that the mode no longer seats (1 and 3 in 1v1). We
    // do NOT auto-evict; instead we refuse to launch a mismatched lobby so a
    // 1v1 can never produce a >2-human manifest.
    const seatable = new Set<PlayerSlotId>(REQUIRED_SLOTS[this.settings.mode]);
    for (const slotId of ALL_SLOTS) {
      const occupied = this.seats.has(slotId) || this.bots.has(slotId);
      if (occupied && !seatable.has(slotId)) {
        if (hostConnection) {
          const notice: LobbyNotice = {
            type: "LobbyNotice",
            reason: "slot-out-of-mode",
          };
          hostConnection.send(serializeLobbyNotice(notice));
        }
        return;
      }
    }

    // ── Guard: reject if any mode-required slot is entirely empty ──────────
    const required = REQUIRED_SLOTS[this.settings.mode];
    for (const slotId of required) {
      if (!this.seats.has(slotId) && !this.bots.has(slotId)) {
        if (hostConnection) {
          const notice: LobbyNotice = {
            type: "LobbyNotice",
            reason: "empty-required-slot",
          };
          hostConnection.send(serializeLobbyNotice(notice));
        }
        return;
      }
    }

    this.locked = true;

    // Snapshot every present human's (playerId → connId) BEFORE the DO→DO RPC
    // await below. The guard above already established that every occupied seat
    // is present (connId !== null); we capture those connIds explicitly so we
    // can detect a drop that happens DURING the await (finding #4): the DO input
    // gate does NOT block on a non-storage RPC await, so a player's WebSocket
    // close can run onClose() (nulling seat.connId) in that window.
    const presentSnapshot = new Map<string, string>();
    for (const seat of this.seats.values()) {
      if (seat.connId !== null) presentSnapshot.set(seat.playerId, seat.connId);
    }

    const launchId = crypto.randomUUID().replace(/-/g, "");

    // Build the manifest slots from current humans + bots.
    const manifestSlots: MatchManifestSlot[] = [];
    const tokenToSlot: Record<string, PlayerSlotId> = {};
    const launchByPlayer = new Map<string, MatchLaunch>();

    // Build the manifest only from the current mode's slot set (the out-of-mode
    // guard above already rejected any occupant outside it, but routing through
    // the mode slots keeps mode→slots a single source of truth).
    for (const slotId of REQUIRED_SLOTS[this.settings.mode]) {
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

    // Write the immutable manifest into the MatchLaunch DO (DO→DO RPC). This is
    // a NON-storage await: the DO input gate does NOT block here, so a player's
    // WebSocket close can be delivered (running onClose, nulling their seat's
    // connId) in this exact window. That is the finding #4 race, re-validated
    // below and exercised by the privateLobby integration test.
    const stub = await getServerByName(this.env.MATCH_LAUNCH, launchId);
    await stub.put({ manifest, tokenToSlot });

    // ── Re-validate presence AFTER the await (finding #4) ──────────────────
    // If any snapshotted human dropped (or reconnected on a different connId)
    // during the await, their committed joinToken can never be delivered to a
    // live socket, so the MatchRoom would wait forever for a human who can't
    // join. A partial launch is worse than no launch: ABORT instead.
    //
    // Reverting `locked` to false is safe: lock() is idempotent-guarded at the
    // top (`if (this.locked) return`), and the only state mutated before this
    // point is the `locked` flag itself, which we revert here. A re-lock mints
    // a brand-new launchId, so the manifest already written under THIS launchId
    // is harmless — nobody can reach it (its tokens were never delivered).
    let dropped = false;
    for (const [pid, connId] of presentSnapshot) {
      const slotId = this.playerToSlot.get(pid);
      const seat = slotId === undefined ? undefined : this.seats.get(slotId);
      if (!seat || seat.connId !== connId) {
        dropped = true;
        break;
      }
    }

    if (dropped) {
      this.locked = false;
      this.lastLaunch = null;

      // The drop's onClose() ran while `locked` was still true, so it skipped
      // the two-stage expiry bookkeeping (absentSince + alarm). Now that we are
      // unlocked again, re-run that bookkeeping for any seat that is absent but
      // untracked, otherwise the ghost seat would never expire and the lobby
      // would be stuck unable to re-lock.
      const now = Date.now();
      let recovered = false;
      for (const seat of this.seats.values()) {
        if (seat.connId === null && !this.absentSince.has(seat.playerId)) {
          this.absentSince.set(seat.playerId, now);
          this.hostTransferred.delete(seat.playerId);
          recovered = true;
        }
      }
      if (recovered) this.scheduleNextAlarm();

      if (hostConnection) {
        const notice: LobbyNotice = {
          type: "LobbyNotice",
          reason: "absent-human",
        };
        hostConnection.send(serializeLobbyNotice(notice));
      }
      return;
    }

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
   * Phase 6 (two-stage): the set of playerIds currently tracked as absent
   * with a pending expiry deadline (for unit test inspection).
   */
  get absentPlayers(): ReadonlyMap<string, number> {
    return this.absentSince;
  }

  /**
   * Phase 6: whether a host-transfer is pending (for unit test inspection).
   * Non-null when the host has disconnected and Stage 1 hasn't fired yet.
   * Preserved for backward compatibility with existing tests.
   */
  get pendingHostTransfer(): string | null {
    for (const [playerId] of this.absentSince) {
      if (
        playerId === this.hostPlayerId &&
        !this.hostTransferred.has(playerId)
      ) {
        return playerId;
      }
    }
    return null;
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
