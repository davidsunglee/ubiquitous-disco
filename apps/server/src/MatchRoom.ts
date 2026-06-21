import {
  type AckBySlot,
  type MatchClosed,
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
  toAuthoritativeState,
} from "@bb/sim";
import { type Client, Room } from "@colyseus/core";
import { FixedStepAccumulator } from "./fixedStep";
import { InputBuffer } from "./inputBuffer";
import {
  botSource,
  humanSource,
  type SlotInputSource,
} from "./slotInputSource";

// 30Hz tick → 15Hz snapshot
const SNAPSHOT_EVERY = 2;
const FIXED_STEP_MS = 1000 / DEFAULT_CONFIG.tickHz; // 33.33ms

const MODE_2V2: PlayerSlotId[] = [0, 1, 2, 3];

export class MatchRoom extends Room {
  maxClients = 4;
  // patchRate is set to 0 inside onCreate(), AFTER setSimulationInterval — not
  // as a class field. See the comment at that assignment for why the ordering
  // matters (it avoids an orphaned 60Hz clock.tick() interval).

  private slotOf = new Map<string, PlayerSlotId>();
  private activeSlots: PlayerSlotId[] = MODE_2V2;
  /** Set to true once disconnect() has been called so double-dispose is avoided. */
  private roomDisposed = false;

  // Authoritative sim + sources (initialised in onCreate after initSim() is awaited)
  private sim!: ReturnType<typeof createSimulation>;
  /**
   * Input buffer per ACTIVE human slot, keyed by Player Slot id.
   * Only human slots have buffers; bot slots go through botSource directly.
   */
  private buffers = new Map<PlayerSlotId, InputBuffer>();
  /**
   * Input source per ACTIVE slot (human or bot), keyed by Player Slot id.
   * tickOnce() calls source.take(view) uniformly for all slots.
   */
  private sources = new Map<PlayerSlotId, SlotInputSource>();
  private stepClock = new FixedStepAccumulator(FIXED_STEP_MS);
  private serverTick = 0;

  onCreate(options?: { botSlots?: PlayerSlotId[] }): void {
    // Construct the simulation here (not as a class field) so that Rapier WASM
    // is guaranteed to have been initialised via initSim() in index.ts before
    // any room can be created.
    this.sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 1234,
      activeSlots: this.activeSlots,
    });

    // Build input sources: bot for declared bot slots, human (buffered) for the rest.
    const botSlots = new Set<PlayerSlotId>(options?.botSlots ?? []);
    for (const s of this.activeSlots) {
      if (botSlots.has(s)) {
        this.sources.set(s, botSource(s, DEFAULT_CONFIG));
      } else {
        const buf = new InputBuffer();
        this.buffers.set(s, buf);
        this.sources.set(s, humanSource(buf));
      }
    }

    // Register PlayerInput handler — ignore frames for bot slots.
    this.onMessage("PlayerInput", (client, msg: PlayerInput) => {
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

  private tickOnce(): void {
    // Build per-slot BotWorldView from current authoritative state (before stepping).
    const worldView = this.buildBotWorldView();

    // Build the per-slot input row from slot sources. Bot slots call
    // samplePracticeBotInput; human slots pull from the InputBuffer.
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

  onJoin(client: Client): void {
    // Assign the next unoccupied HUMAN active slot in template order.
    // Bot slots are pre-configured and skipped during join.
    const taken = new Set(this.slotOf.values());
    const unoccupied = this.activeSlots.find(
      (s) => !taken.has(s) && this.sources.get(s)?.isHuman,
    );
    // biome-ignore lint/style/noNonNullAssertion: activeSlots always has at least one human slot (MODE_2V2 has 4)
    const slot: PlayerSlotId = unoccupied ?? this.activeSlots[0]!;
    this.slotOf.set(client.sessionId, slot);

    // "full" when all human slots are occupied (bot slots don't count as clients).
    const humanSlotCount = [...this.activeSlots].filter(
      (s) => this.sources.get(s)?.isHuman,
    ).length;
    const full = this.slotOf.size === humanSlotCount;

    // Tell this client its own slot assignment.
    // Phase 1 note: each client gets its OWN slot — per-recipient send, not broadcast.
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

  onLeave(client: Client): void {
    this.slotOf.delete(client.sessionId);
    if (this.roomDisposed) return; // Already shutting down — avoid double-dispose.
    this.roomDisposed = true;
    // Fail-closed: any disconnect ends the match. Broadcast MatchClosed to all
    // remaining clients so they show the fail-closed banner. No reconnect.
    const msg: MatchClosed = {
      type: "MatchClosed",
      reason: "peer-left",
    };
    this.broadcast("MatchClosed", msg);
    // Dispose the room — this disconnects any remaining clients.
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

  /** Expose sim for testing. */
  get simulation() {
    return this.sim;
  }

  /** True once disconnect() has been called (fail-closed path). For testing. */
  get isDisposed(): boolean {
    return this.roomDisposed;
  }
}
