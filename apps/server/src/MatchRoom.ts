import {
  type AckBySlot,
  DEFAULT_RECONNECT_CONFIG,
  type MatchClosed,
  type MatchManifest,
  type PlayerInput,
  type PlayerSlotId,
  uint8ArrayToBase64,
  type WorldSnapshot,
} from "@bb/protocol";
import {
  type BotWorldView,
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  type SimConfig,
  toAuthoritativeState,
} from "@bb/sim";
import { type Client, Room } from "@colyseus/core";
import { FixedStepAccumulator } from "./fixedStep";
import { InputBuffer } from "./inputBuffer";
import { claim } from "./lobbyClient";
import {
  botSource,
  emptySource,
  humanSource,
  type SlotInputSource,
} from "./slotInputSource";

// 30Hz tick → 15Hz snapshot
const SNAPSHOT_EVERY = 2;
const FIXED_STEP_MS = 1000 / DEFAULT_CONFIG.tickHz; // 33.33ms

const MODE_2V2: PlayerSlotId[] = [0, 1, 2, 3];

function configuredReconnectGraceMs(): number {
  const raw = process.env.RECONNECT_GRACE_MS;
  if (raw === undefined) return DEFAULT_RECONNECT_CONFIG.reconnectGraceMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_RECONNECT_CONFIG.reconnectGraceMs;
}

/**
 * Per-reserved-slot state during the Phase 6 reconnect grace window.
 * The slot's source is swapped to `emptySource()` while reserved.
 */
interface ReservedSlot {
  /** The launchId that must be reclaimed to cancel this reservation. */
  launchId: string;
  /** The joinToken that may reclaim this slot (idempotent within grace). */
  joinToken: string;
  /** Timer handle for the grace-expiry callback. */
  timer: ReturnType<typeof setTimeout> | null;
}

export class MatchRoom extends Room {
  maxClients = 4;
  // patchRate is set to 0 inside onCreate(), AFTER setSimulationInterval — not
  // as a class field. See the comment at that assignment for why the ordering
  // matters (it avoids an orphaned 60Hz clock.tick() interval).

  private slotOf = new Map<string, PlayerSlotId>();
  private activeSlots: PlayerSlotId[] = MODE_2V2;
  /** Set to true once disconnect() has been called so double-dispose is avoided. */
  private roomDisposed = false;

  /**
   * The immutable launch manifest (Phase 5). Cached on the first successful
   * claim; configures active slots, bot sources, and match settings. Null until
   * the first human joins.
   */
  private manifest: MatchManifest | null = null;
  /** True once configureFromManifest() has built the sim + sources. */
  private configured = false;
  /** Sim config derived from the manifest's match settings. */
  private simConfig: SimConfig = DEFAULT_CONFIG;

  /** Bot slots for the dev/test direct-connect fallback (from create options). */
  private legacyBotSlots: PlayerSlotId[] = [];

  // Authoritative sim + sources (built in configureFromManifest on first join)
  private sim!: ReturnType<typeof createSimulation>;
  /**
   * Input buffer per ACTIVE human slot, keyed by Player Slot id.
   * Only human slots have buffers; bot slots go through botSource directly.
   */
  private buffers = new Map<PlayerSlotId, InputBuffer>();
  /**
   * Input source per ACTIVE slot (human or bot), keyed by Player Slot id.
   * tickOnce() calls source.take(view) uniformly for all slots.
   * Phase 6: a reserved slot's source is replaced with emptySource().
   */
  private sources = new Map<PlayerSlotId, SlotInputSource>();
  private stepClock = new FixedStepAccumulator(FIXED_STEP_MS);
  private serverTick = 0;

  /**
   * Phase 6: per-slot reservation state during the reconnect grace window.
   * Keyed by Player Slot id. A reserved slot is fed EMPTY_INPUT until the
   * human reclaims it (same-token re-join) or the grace timer fires.
   */
  private reservedSlots = new Map<PlayerSlotId, ReservedSlot>();

  /**
   * Phase 6: per-slot original human sources, saved while a slot is reserved.
   * On reclaim the original source is restored so pending input can resume.
   */
  private savedHumanSources = new Map<PlayerSlotId, SlotInputSource>();

  /**
   * Phase 6: the launch options from the first join, stored so that reclaims
   * (same token, re-join) can be validated against the same launchId.
   * Keyed by Player Slot id → { launchId, joinToken }.
   */
  private slotLaunchOptions = new Map<
    PlayerSlotId,
    { launchId: string; joinToken: string }
  >();

  /**
   * onCreate runs before any onJoin. The sim + input sources are NOT built here
   * — they depend on the launch manifest, which is only known after the first
   * client's claim succeeds (configureFromManifest). The simulation interval is
   * installed now but no-ops until the room is configured.
   *
   * `options.launchId` is carried by joinOrCreate and used by the matchmaker's
   * filterBy("launchId") so all humans of one launch land in the same room.
   */
  onCreate(options?: { launchId?: string; botSlots?: PlayerSlotId[] }): void {
    // Capture bot slots for the dev/test direct-connect fallback (the launch
    // path ignores this and uses the manifest instead).
    this.legacyBotSlots = options?.botSlots ?? [];

    // Register PlayerInput handler — ignore frames for bot slots and for input
    // arriving before the room is configured.
    this.onMessage("PlayerInput", (client, msg: PlayerInput) => {
      if (!this.configured) return;
      const s = this.slot(client);
      if (this.sources.get(s)?.isHuman) {
        this.buffers.get(s)?.push(msg.frames);
      }
    });

    // Fixed-step authoritative loop at 30Hz.
    //
    // setSimulationInterval fires roughly every FIXED_STEP_MS. We drive the loop
    // from FixedStepAccumulator (real wall-clock time) rather than the delta
    // Colyseus passes, so the sim stays at a true 30Hz regardless of timer jitter.
    this.setSimulationInterval(() => {
      const steps = this.stepClock.pump();
      for (let i = 0; i < steps; i++) {
        this.tickOnce();
      }
    }, FIXED_STEP_MS);

    // Disable Schema patch broadcasting (we broadcast our own WorldSnapshots).
    // This MUST run after setSimulationInterval: Colyseus's patchRate setter
    // only installs its 60Hz clock.tick() fallback interval when no simulation
    // interval exists yet (`else if (!this._simulationInterval)`). Setting it as
    // a class field — before onCreate — tripped that branch and left an orphaned
    // 60Hz ticker running for the room's lifetime. Setting it here skips it.
    this.patchRate = 0;
  }

  private buildBotWorldView(): {
    tick: number;
    ball: { x: number; y: number; vx: number; vy: number };
    selves: (BotWorldView["self"] | undefined)[];
  } {
    const render = this.sim.getRenderState();
    const ballVel = this.sim.getBallVel();
    const selves: (BotWorldView["self"] | undefined)[] = [];
    for (const s of this.activeSlots) {
      const p = render.players[s];
      if (p) {
        selves[s] = {
          x: p.x,
          y: p.y,
          facing: p.facing,
          grounded: p.grounded,
        };
      }
    }
    return {
      tick: this.serverTick,
      ball: {
        x: render.ball.x,
        y: render.ball.y,
        vx: ballVel.vx,
        vy: ballVel.vy,
      },
      selves,
    };
  }

  /**
   * Configure the room from the immutable launch manifest (first join only).
   * Derives active slots, builds a bot SlotInputSource for each bot slot and a
   * buffered human source for each human slot, and applies the manifest's match
   * length to the sim config. Replaces the Phase 3 `botSlots` create option.
   */
  private configureFromManifest(manifest: MatchManifest): void {
    this.manifest = manifest;
    this.activeSlots = [...manifest.slots]
      .map((s) => s.slotId)
      .sort((a, b) => a - b);

    // Apply the manifest's match length to the sim config (tickHz unchanged).
    this.simConfig = {
      ...DEFAULT_CONFIG,
      match: {
        ...DEFAULT_CONFIG.match,
        lengthTicks: manifest.settings.matchLengthTicks,
      },
    };

    this.sim = createSimulation({
      config: this.simConfig,
      arena: FLAT_DOJO,
      seed: 1234,
      activeSlots: this.activeSlots,
    });

    const botSlots = new Set<PlayerSlotId>(
      manifest.slots.filter((s) => s.kind === "bot").map((s) => s.slotId),
    );
    for (const s of this.activeSlots) {
      if (botSlots.has(s)) {
        this.sources.set(s, botSource(s, this.simConfig));
      } else {
        const buf = new InputBuffer();
        this.buffers.set(s, buf);
        this.sources.set(s, humanSource(buf));
      }
    }

    this.configured = true;
  }

  private tickOnce(): void {
    // No-op until the room has been configured from a launch manifest.
    if (!this.configured) return;

    // Build per-slot BotWorldView from current authoritative state (before stepping).
    const worldView = this.buildBotWorldView();

    // Build the per-slot input row from slot sources. Bot slots call
    // samplePracticeBotInput; human slots pull from the InputBuffer.
    // Phase 6: reserved slots have their source replaced with emptySource()
    // so they return EMPTY_INPUT after normal buffer-gap handling.
    const inputRow: InputFrame[] = [];
    const lastAckedSeq: AckBySlot = [0, 0, 0, 0];
    for (const s of this.activeSlots) {
      const src = this.sources.get(s);
      if (!src) continue;
      const self = worldView.selves[s];
      const view: BotWorldView = {
        tick: worldView.tick,
        ball: worldView.ball,
        // Provide a neutral self-view if the slot somehow has no render state.
        self: self ?? { x: 0, y: 0, facing: 1, grounded: false },
      };
      const taken = src.take(view);
      inputRow[s] = taken.input ?? EMPTY_INPUT;
      lastAckedSeq[s] = src.lastAckedSeq; // bot → 0
    }
    this.sim.step(inputRow);
    this.serverTick += 1;

    if (this.serverTick % SNAPSHOT_EVERY === 0) {
      const auth = toAuthoritativeState(this.sim);

      // Encode rapierBytes as base64 for JSON transport.
      const rapierBytesB64 = uint8ArrayToBase64(auth.rapierBytes);

      const snapshot: WorldSnapshot = {
        type: "WorldSnapshot",
        serverTick: this.serverTick,
        players: auth.players,
        ball: auth.ball,
        rapierBytesB64,
        match: auth.match,
        lastAckedSeq,
      };

      // The snapshot already carries lastAckedSeq, and the client trims its
      // pending list from snap.lastAckedSeq (NetLoop.applySnapshot). A separate
      // InputAck broadcast would be redundant I/O at the same 15Hz cadence.
      this.broadcast("WorldSnapshot", snapshot);
    }
  }

  /**
   * Validate the client's launch claim against the worker, map them to their
   * CLAIMED Player Slot (not join order), and configure the room from the
   * manifest on first join. Rejects invalid/duplicate claims by leaving.
   *
   * Phase 6 — reclaim path: a reconnecting human re-joins with the same
   * { launchId, joinToken }. The MatchLaunch DO treats it as an idempotent
   * reclaim within grace and returns the same slot. The room cancels the
   * reservation for that slot and rebinds the human source.
   *
   * Dev/test direct-connect shortcut (no launch options): falls back to the
   * Plan 1 join-order path with a legacy 2v2 manifest (humans on non-bot slots,
   * bots on the create-time `botSlots`). The primary acceptance path is the
   * launch handoff; this fallback exists only so the netcode regression specs
   * (latency/disconnect/reconciliation) can run without the worker + lobby.
   */
  async onJoin(
    client: Client,
    options?: { launchId?: string; joinToken?: string },
  ): Promise<void> {
    const launchId = options?.launchId;
    const joinToken = options?.joinToken;

    if (!launchId || !joinToken) {
      // Legacy direct-connect path.
      if (!this.configured) {
        this.configureFromManifest(this.legacyManifest());
      }
      const taken = new Set(this.slotOf.values());
      const found = this.activeSlots.find(
        (s) => !taken.has(s) && this.sources.get(s)?.isHuman,
      );
      const slot: PlayerSlotId = found ?? this.activeSlots[0] ?? 0;
      this.seatAndAnnounce(client, slot);
      return;
    }

    const res = await claim(launchId, joinToken);
    if (!res.ok || res.playerSlotId === undefined || !res.manifest) {
      // Invalid / duplicate / unauthorised claim — fail closed.
      client.leave();
      return;
    }

    const claimedSlot = res.playerSlotId;

    // Configure the room from the manifest on the first successful claim.
    if (!this.configured) this.configureFromManifest(res.manifest);

    // Phase 6: check if this join is a reclaim of a reserved slot.
    const reservation = this.reservedSlots.get(claimedSlot);
    if (reservation) {
      if (
        reservation.launchId !== launchId ||
        reservation.joinToken !== joinToken
      ) {
        client.leave();
        return;
      }
      // This slot was reserved (player disconnected and is within grace). Cancel
      // the grace timer and restore the human source.
      this.cancelReservation(claimedSlot);
      // Re-seat the reconnected client at their original slot.
      this.seatAndAnnounce(client, claimedSlot);
      return;
    }

    if ([...this.slotOf.values()].includes(claimedSlot)) {
      client.leave();
      return;
    }

    // First-time join — record the launch options for potential future reclaim.
    this.slotLaunchOptions.set(claimedSlot, { launchId, joinToken });
    this.seatAndAnnounce(client, claimedSlot);
  }

  /** Seat a client at the given slot and send RoomReady (and full=true to all). */
  private seatAndAnnounce(client: Client, slot: PlayerSlotId): void {
    this.slotOf.set(client.sessionId, slot);

    // "full" when every human slot that is NOT currently reserved (mid-grace) is
    // occupied by a present client (bot slots don't count as clients). A reserved
    // slot's source is emptySource(), whose isHuman is true, so it still counts in
    // humanSlotCount — discount the reserved slots so a single reconnect can be
    // "full" while a co-disconnected peer is still within its grace window.
    const humanSlotCount = [...this.activeSlots].filter(
      (s) => this.sources.get(s)?.isHuman,
    ).length;
    const full = this.slotOf.size + this.reservedSlots.size === humanSlotCount;

    // Each client gets its OWN slot — per-recipient send, not broadcast.
    client.send("RoomReady", {
      type: "RoomReady",
      slot,
      full: false,
      slots: this.activeSlots,
    });

    if (full) {
      // All players present — send each client their own "full=true" with correct slot.
      for (const [sessionId, s] of this.slotOf) {
        const target = this.clients.find((c) => c.sessionId === sessionId);
        if (target) {
          target.send("RoomReady", {
            type: "RoomReady",
            slot: s,
            full: true,
            slots: this.activeSlots,
          });
        }
      }
    }
  }

  /** Build a legacy 2v2 manifest for the dev/test direct-connect path. */
  private legacyManifest(): MatchManifest {
    const bots = new Set(this.legacyBotSlots);
    return {
      launchId: "legacy-dev",
      slots: MODE_2V2.map((slotId) =>
        bots.has(slotId)
          ? { slotId, kind: "bot" as const }
          : { slotId, kind: "human" as const, playerId: `dev-${slotId}` },
      ),
      settings: {
        mode: "2v2",
        matchLengthTicks: DEFAULT_CONFIG.match.lengthTicks,
        arenaId: "flat-dojo",
      },
    };
  }

  onLeave(client: Client): void {
    const slot = this.slotOf.get(client.sessionId);
    this.slotOf.delete(client.sessionId);

    if (this.roomDisposed) return; // Already shutting down — avoid double-dispose.

    if (slot === undefined) return; // Unknown client — nothing to reserve.

    // Phase 6: reserve a human slot for reconnect ONLY when it carries real
    // launch reclaim credentials (the lobby-launch path sets slotLaunchOptions
    // on first join). The legacy dev/test direct-connect path has no joinToken
    // to reclaim with, so it keeps the Plan 1 immediate fail-closed behaviour
    // (the netcode regression specs depend on a prompt `peer-left`).
    if (
      this.configured &&
      this.sources.get(slot)?.isHuman &&
      this.slotLaunchOptions.has(slot)
    ) {
      this.reserveSlot(slot);
      return;
    }

    // Bot slot, room not yet configured, or legacy direct-connect (no reclaim
    // credentials) — fall through to the original fail-closed path.
    this.failClose("peer-left");
  }

  /**
   * Phase 6: reserve a human slot for reconnect.
   *
   * - Saves the human source and replaces it with emptySource() so EMPTY_INPUT
   *   is fed for each tick during the grace window.
   * - Schedules a grace-expiry timer (testable via the graceExpiryTimers map).
   *   On expiry, fail-closes the room with `reconnect-expired`.
   */
  private reserveSlot(slot: PlayerSlotId): void {
    // Save the original human source and replace with empty source.
    const originalSource = this.sources.get(slot);
    if (originalSource) {
      this.savedHumanSources.set(slot, originalSource);
    }
    this.sources.set(slot, emptySource());

    // Retrieve the launch options for this slot so the reclaim can match them.
    const launchOpts = this.slotLaunchOptions.get(slot) ?? {
      launchId: "",
      joinToken: "",
    };

    // Schedule grace-expiry timer.
    const timer = this._scheduleGraceTimer(slot);

    this.reservedSlots.set(slot, {
      launchId: launchOpts.launchId,
      joinToken: launchOpts.joinToken,
      timer,
    });
  }

  /**
   * Schedule the grace-expiry timer for a reserved slot.
   * Returns the timer handle (stored in reservedSlots so it can be cancelled).
   *
   * Exposed as a protected method so tests can override it to fire
   * synchronously (rather than waiting real wall-clock time).
   */
  protected _scheduleGraceTimer(
    slot: PlayerSlotId,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.onGraceExpired(slot);
    }, configuredReconnectGraceMs());
  }

  /**
   * Phase 6: called when the grace window for a reserved slot expires without
   * a successful reclaim. Fail-closes the room for all remaining clients.
   */
  private onGraceExpired(slot: PlayerSlotId): void {
    // If the slot was already reclaimed or the room disposed, do nothing.
    if (!this.reservedSlots.has(slot) || this.roomDisposed) return;
    this.reservedSlots.delete(slot);
    this.savedHumanSources.delete(slot);
    this.failClose("reconnect-expired");
  }

  /**
   * Cancel the grace reservation for a slot (called on successful reclaim).
   * Restores the original human source.
   */
  private cancelReservation(slot: PlayerSlotId): void {
    const reservation = this.reservedSlots.get(slot);
    if (!reservation) return;
    if (reservation.timer !== null) {
      clearTimeout(reservation.timer);
    }
    this.reservedSlots.delete(slot);

    // Restore the original human source (or fall back to a fresh buffer).
    const savedSource = this.savedHumanSources.get(slot);
    if (savedSource) {
      this.sources.set(slot, savedSource);
      this.savedHumanSources.delete(slot);
    } else {
      // Fallback: create a fresh human source with a new buffer.
      const buf = new InputBuffer();
      this.buffers.set(slot, buf);
      this.sources.set(slot, humanSource(buf));
    }
  }

  /** Broadcast MatchClosed and dispose the room. */
  private failClose(reason: MatchClosed["reason"]): void {
    if (this.roomDisposed) return;
    this.roomDisposed = true;
    // Cancel all pending grace timers before disposing.
    for (const [s, reservation] of this.reservedSlots) {
      if (reservation.timer !== null) clearTimeout(reservation.timer);
      this.reservedSlots.delete(s);
    }
    const msg: MatchClosed = { type: "MatchClosed", reason };
    this.broadcast("MatchClosed", msg);
    void this.disconnect();
  }

  slot(client: Client): PlayerSlotId {
    return this.slotOf.get(client.sessionId) ?? 0;
  }

  /** Expose slot map size for testing without coupling to Colyseus internals. */
  get slotCount(): number {
    return this.slotOf.size;
  }

  /** Expose slot for a given sessionId for testing. */
  slotForSession(sessionId: string): PlayerSlotId | undefined {
    return this.slotOf.get(sessionId);
  }

  /** Expose serverTick for testing. */
  get tick(): number {
    return this.serverTick;
  }

  /** Expose buffers for testing. */
  get inputBuffers(): Map<PlayerSlotId, InputBuffer> {
    return this.buffers;
  }

  /** Expose sources for testing. */
  get inputSources(): Map<PlayerSlotId, SlotInputSource> {
    return this.sources;
  }

  /** True once the room has been configured from a launch manifest. For testing. */
  get isConfigured(): boolean {
    return this.configured;
  }

  /** The cached launch manifest (or null). For testing. */
  get launchManifest(): MatchManifest | null {
    return this.manifest;
  }

  /** The room's active Player Slots (from the manifest, once configured). For testing. */
  get activePlayerSlots(): PlayerSlotId[] {
    return this.activeSlots;
  }

  /**
   * Configure the room from a manifest directly, bypassing the claim HTTP call.
   * For testing the tick/snapshot/bot-source paths without a live worker.
   */
  testConfigureFromManifest(manifest: MatchManifest): void {
    this.configureFromManifest(manifest);
  }

  /** Expose sim for testing. */
  get simulation() {
    return this.sim;
  }

  /** True once disconnect() has been called (fail-closed path). For testing. */
  get isDisposed(): boolean {
    return this.roomDisposed;
  }

  /**
   * Phase 6: expose reserved slots for testing (which slots are in grace window).
   */
  get reservedSlotIds(): PlayerSlotId[] {
    return [...this.reservedSlots.keys()];
  }

  /**
   * Phase 6: test hook — trigger grace expiry for a reserved slot immediately,
   * without waiting real wall-clock time. Simulates the alarm firing.
   */
  testTriggerGraceExpiry(slot: PlayerSlotId): void {
    const reservation = this.reservedSlots.get(slot);
    if (reservation?.timer !== null && reservation?.timer !== undefined) {
      clearTimeout(reservation.timer);
    }
    this.onGraceExpired(slot);
  }

  /**
   * Phase 6: seed the slot launch options for a given slot. Used in tests
   * that call testConfigureFromManifest() and then simulate a leave/reclaim
   * without going through the full onJoin claim path.
   */
  testSetSlotLaunchOptions(
    slot: PlayerSlotId,
    opts: { launchId: string; joinToken: string },
  ): void {
    this.slotLaunchOptions.set(slot, opts);
  }
}
