/**
 * NetLoop — Phase 3: predicted client loop with reconciliation.
 *
 * Each fixed tick:
 *  1. Collects the local slot's InputFrame.
 *  2. Pushes it to pendingInputs (seq + tick) for reconciliation.
 *  3. Sends PlayerInput { frames: [current + last 3 unacked] } to server.
 *  4. Sets the remote slot's Rapier body from the interpolation buffer
 *     (Q4: drives remote at current serverTick - INTERP_DELAY_TICKS).
 *  5. Steps the local prediction sim with [localInput, EMPTY_INPUT].
 *  6. Updates prev/cur from the predicted sim for lerp rendering.
 *  7. Drains predicted sim events for immediate local feedback.
 *
 * On WorldSnapshot:
 *  - Pushes the remote player's authoritative pose into InterpolationBuffer.
 *  - Calls Reconciler.reconcile(snap):
 *      a) applyAuthoritativeState (rapierBytes restore path — 0b).
 *      b) discard acked pending inputs.
 *      c) replay remaining unacked, feeding historical remote positions (0d).
 *      d) smooth small / snap large corrections.
 *  - Reconciler's onCorrectedState callback updates prev/cur.
 *
 * The render loop in GameScene uses prev/cur + alpha for the local predicted
 * render, and samples the InterpolationBuffer for the remote player render
 * (at serverTick - INTERP_DELAY_TICKS).
 */

import type { PlayerInput, SeqInput, Slot, WorldSnapshot } from "@bb/protocol";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  type MatchState,
  type RenderState,
} from "@bb/sim";
import { FIXED_STEP_MS, INTERP_DELAY_TICKS } from "./config";
import { InterpolationBuffer } from "./InterpolationBuffer";
import type { NetClient } from "./NetClient";
import { type PendingInput, Reconciler } from "./Reconciler";
import type { SimulatedTransport } from "./SimulatedTransport";
import { SnapshotQueue } from "./snapshotQueue";

// Max unacked tail frames to send for reliability.
const MAX_REDUNDANT = 3;

export interface NetLoopCallbacks {
  /** Called when the local render state updates (predicted or reconciled). */
  onRenderState(prev: RenderState, cur: RenderState): void;
  /** Called when match state changes (for HUD). */
  onMatchState(m: MatchState): void;
  /** Called when the connection drops or the server closes the match. */
  onDisconnect(): void;
}

export class NetLoop {
  private seq = 0;
  /** Next local tick counter (advances each predicted step). */
  private localTick = 0;
  private pending: SeqInput[] = [];
  private accumulator = 0;

  /** The last predicted render state for lerp rendering. */
  private prevRender: RenderState | null = null;
  private curRender: RenderState | null = null;

  /** The last received server tick (for interp buffer sampling). */
  latestServerTick = 0;

  /** Latest match state from snapshots. */
  latestMatchState: MatchState | null = null;

  private net: NetClient;
  private slot: Slot;
  private cb: NetLoopCallbacks;

  /** Optional network simulator. When set, all send/receive is routed through it. */
  readonly transport: SimulatedTransport | null;

  /** Snapshot queue: drops obsolete snapshots before applying. */
  private snapshotQueue = new SnapshotQueue();

  // Client-side prediction sim.
  private sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  private simReady = false;

  // Interpolation buffer for the remote slot.
  readonly interpBuffer = new InterpolationBuffer();

  // Reconciler: handles snapshot → replay → smooth/snap.
  private reconciler: Reconciler;

  constructor(
    net: NetClient,
    slot: Slot,
    cb: NetLoopCallbacks,
    transport: SimulatedTransport | null = null,
  ) {
    this.net = net;
    this.slot = slot;
    this.cb = cb;
    this.transport = transport;

    const remoteSlot: Slot = slot === 0 ? 1 : 0;

    this.reconciler = new Reconciler(
      this.sim,
      slot,
      remoteSlot,
      this.interpBuffer,
      (prev, cur) => {
        // Reconciler pushes corrected state back here.
        this.prevRender = prev;
        this.curRender = cur;
        this.cb.onRenderState(prev, cur);
      },
    );

    void initSim().then(() => {
      this.simReady = true;
      // Initialize prev/cur from the starting sim state.
      const s = this.sim.getRenderState();
      this.prevRender = structuredClone(s);
      this.curRender = structuredClone(s);
      this.reconciler.setDisplayedRender(s);
    });
  }

  /** Start listening to server messages. Call after the room is joined. */
  start(): void {
    if (this.transport) {
      // WorldSnapshot goes through the downlink simulator (drop/delay/reorder),
      // then into the snapshot queue (drop obsolete by serverTick).
      this.transport.onMessage("WorldSnapshot", (msg) => {
        this.snapshotQueue.push(msg as WorldSnapshot);
      });

      this.transport.onMessage("InputAck", (msg) => {
        const ack = msg as { lastAckedSeq: [number, number] };
        const ackedForSlot = ack.lastAckedSeq[this.slot] ?? 0;
        this.trimPending(ackedForSlot);
      });
    } else {
      // No simulator: snapshots still go through the queue to enforce the
      // "drop obsolete by serverTick" policy even without simulated latency.
      this.net.onMessage("WorldSnapshot", (msg) => {
        this.snapshotQueue.push(msg as WorldSnapshot);
      });

      this.net.onMessage("InputAck", (msg) => {
        const ack = msg as { lastAckedSeq: [number, number] };
        const ackedForSlot = ack.lastAckedSeq[this.slot] ?? 0;
        this.trimPending(ackedForSlot);
      });
    }

    this.net.onLeave((_code) => {
      this.cb.onDisconnect();
    });
  }

  /**
   * Advance the net loop by `delta` ms. Called from the Phaser update loop.
   * `collectLocalInput` is called by GameScene to provide the current frame
   * for the local slot.
   */
  tick(delta: number, collectLocalInput: () => InputFrame): void {
    if (!this.simReady) return;

    // Tick the network simulator to fire any due delayed deliveries.
    this.transport?.tick();

    // Drain one pending snapshot (if any) per outer tick call to apply the
    // latest authoritative state before advancing local prediction ticks.
    const snap = this.snapshotQueue.drain();
    if (snap) {
      this.applySnapshot(snap);
    }

    this.accumulator += delta;
    while (this.accumulator >= FIXED_STEP_MS) {
      this.accumulator -= FIXED_STEP_MS;
      this.tickOnce(collectLocalInput());
    }
  }

  private tickOnce(localInput: InputFrame): void {
    this.seq += 1;
    this.localTick += 1;

    const seqEntry: SeqInput = { seq: this.seq, input: localInput };
    this.pending.push(seqEntry);

    // Track this input in the reconciler's pending queue (with local tick for
    // interpolation buffer lookup during replay — Design 0d).
    const pendingEntry: PendingInput = {
      seq: this.seq,
      tick: this.localTick,
      input: localInput,
    };
    this.reconciler.addPending(pendingEntry);

    // Send current + last MAX_REDUNDANT unacked for reliability (Q6).
    const tail = this.pending.slice(-MAX_REDUNDANT);
    const msg: PlayerInput = {
      type: "PlayerInput",
      slot: this.slot,
      frames: [seqEntry, ...tail.filter((f) => f.seq !== seqEntry.seq)],
    };
    // Route through uplink simulator if present, otherwise send directly.
    if (this.transport) {
      this.transport.send("PlayerInput", msg);
    } else {
      this.net.send("PlayerInput", msg);
    }

    // Drive the remote slot from the interpolation buffer at
    // serverTick - INTERP_DELAY_TICKS (Q4 + Design 0c).
    const sampleTick = Math.max(0, this.latestServerTick - INTERP_DELAY_TICKS);
    const remotePose = this.interpBuffer.sample(sampleTick);
    const remoteSlot: Slot = this.slot === 0 ? 1 : 0;
    if (remotePose) {
      this.sim.setSlotKinematicPosition(
        remoteSlot,
        remotePose.x,
        remotePose.y,
        remotePose.facing,
      );
    }

    // Step the prediction sim: local slot gets local input, remote gets EMPTY.
    const frames: InputFrame[] = [];
    frames[this.slot] = localInput;
    frames[remoteSlot] = EMPTY_INPUT;
    this.sim.step(frames);

    // Snapshot the predicted render state.
    const cur = structuredClone(this.sim.getRenderState());
    const prev = this.curRender ?? cur;
    this.prevRender = prev;
    this.curRender = cur;
    this.reconciler.setDisplayedRender(cur);

    // Drain predicted sim events for immediate local feedback (flashes).
    // These are cosmetic predictions; reconciliation will correct them if wrong.
    for (const _event of this.sim.drainEvents()) {
      // Events are available for GameScene to tap into via the onRenderState
      // callback cycle. For now, draining keeps the queue clean.
    }

    this.cb.onRenderState(prev, cur);
  }

  private trimPending(ackedSeq: number): void {
    this.pending = this.pending.filter((p) => p.seq > ackedSeq);
  }

  private applySnapshot(snap: WorldSnapshot): void {
    if (!this.simReady) return;

    this.latestServerTick = snap.serverTick;
    this.latestMatchState = snap.match;

    // Push the remote slot's authoritative pose into the interpolation buffer.
    const remoteSlot: Slot = this.slot === 0 ? 1 : 0;
    const remotePoseInSnap = snap.players[remoteSlot];
    if (remotePoseInSnap) {
      this.interpBuffer.push({
        serverTick: snap.serverTick,
        x: remotePoseInSnap.x,
        y: remotePoseInSnap.y,
        vx: remotePoseInSnap.vx,
        vy: remotePoseInSnap.vy,
        facing: remotePoseInSnap.facing,
      });
    }

    // Trim SeqInput pending queue using snapshot's lastAckedSeq.
    const ackedForSlot = snap.lastAckedSeq[this.slot] ?? 0;
    this.trimPending(ackedForSlot);

    // Reconcile: restore authoritative state → replay pending → smooth/snap.
    this.reconciler.reconcile(snap);

    // Notify HUD of match state update.
    this.cb.onMatchState(snap.match);
  }

  /** Current render interpolation alpha (accumulator / step). */
  get renderAlpha(): number {
    return Math.min(1, this.accumulator / FIXED_STEP_MS);
  }

  get currentRender(): RenderState | null {
    return this.curRender;
  }

  get previousRender(): RenderState | null {
    return this.prevRender;
  }

  /**
   * Sample the remote player's interpolated pose for rendering.
   * Called by GameScene each frame to position the remote player.
   * Returns null if the buffer is empty (before any snapshot).
   */
  sampleRemoteRender(): import("./InterpolationBuffer").RemotePose | null {
    const sampleTick = Math.max(0, this.latestServerTick - INTERP_DELAY_TICKS);
    return this.interpBuffer.sample(sampleTick);
  }
}
