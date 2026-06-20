/**
 * NetLoop — Phase 2: naive (un-predicted) authoritative client.
 *
 * Each fixed tick:
 *  1. Collects the local slot's InputFrame.
 *  2. Pushes it to pendingInputs with a monotonic seq.
 *  3. Sends PlayerInput { frames: [current + last 3 unacked] } to the server.
 *
 * On WorldSnapshot:
 *  - Restores the Rapier world via rapierBytesB64 decode → restoreSnapshot().
 *  - Writes actor JS fields for each player from the snapshot.
 *  - Renders directly from the authoritative snapshot (no prediction yet).
 *  - Trims the pending-input queue using lastAckedSeq.
 *
 * Phase 3 will add local prediction + reconciliation on top of this base.
 */

import type { PlayerInput, SeqInput, Slot, WorldSnapshot } from "@bb/protocol";
import type { InputFrame, MatchState, RenderState } from "@bb/sim";
import { createSimulation, DEFAULT_CONFIG, FLAT_DOJO, initSim } from "@bb/sim";
import { FIXED_STEP_MS } from "./config";
import type { NetClient } from "./NetClient";

// Max unacked tail frames to send for reliability.
const MAX_REDUNDANT = 3;

export interface NetLoopCallbacks {
  /** Called when the local render state updates from a snapshot. */
  onRenderState(prev: RenderState, cur: RenderState): void;
  /** Called when match state changes (for HUD). */
  onMatchState(m: MatchState): void;
  /** Called when the connection drops or the server closes the match. */
  onDisconnect(): void;
}

export class NetLoop {
  private seq = 0;
  private pending: SeqInput[] = [];
  private accumulator = 0;

  /** The last authoritative render state (snapshot-derived). */
  private prevRender: RenderState | null = null;
  private curRender: RenderState | null = null;

  /** The last received server tick (for Phase 3 interpolation). */
  latestServerTick = 0;

  /** Latest match state from snapshots. */
  latestMatchState: MatchState | null = null;

  private net: NetClient;
  private slot: Slot;
  private cb: NetLoopCallbacks;

  // Client-side sim for applying authoritative state.
  // In Phase 2 we only use it to decode snapshots (restoreSnapshot).
  private sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  private simReady = false;

  constructor(net: NetClient, slot: Slot, cb: NetLoopCallbacks) {
    this.net = net;
    this.slot = slot;
    this.cb = cb;

    void initSim().then(() => {
      this.simReady = true;
    });
  }

  /** Start listening to server messages. Call after the room is joined. */
  start(): void {
    this.net.onMessage("WorldSnapshot", (msg) => {
      this.applySnapshot(msg as WorldSnapshot);
    });

    this.net.onMessage("InputAck", (msg) => {
      const ack = msg as { lastAckedSeq: [number, number] };
      const ackedForSlot = ack.lastAckedSeq[this.slot] ?? 0;
      this.trimPending(ackedForSlot);
    });

    this.net.onLeave((_code) => {
      this.cb.onDisconnect();
    });
  }

  /**
   * Advance the net loop by `delta` ms. Called from the Phaser update loop.
   * In Phase 2 we only send inputs; rendering is driven by snapshots.
   *
   * `collectLocalInput` is called by GameScene to provide the current frame
   * for the local slot.
   */
  tick(delta: number, collectLocalInput: () => InputFrame): void {
    if (!this.simReady) return;

    this.accumulator += delta;
    while (this.accumulator >= FIXED_STEP_MS) {
      this.accumulator -= FIXED_STEP_MS;
      this.tickOnce(collectLocalInput());
    }
  }

  private tickOnce(localInput: InputFrame): void {
    this.seq += 1;
    const entry: SeqInput = { seq: this.seq, input: localInput };
    this.pending.push(entry);

    // Send current + last MAX_REDUNDANT unacked for reliability.
    const tail = this.pending.slice(-MAX_REDUNDANT);
    const msg: PlayerInput = {
      type: "PlayerInput",
      slot: this.slot,
      frames: [entry, ...tail.filter((f) => f.seq !== entry.seq)],
    };
    this.net.send("PlayerInput", msg);
  }

  private trimPending(ackedSeq: number): void {
    this.pending = this.pending.filter((p) => p.seq > ackedSeq);
  }

  private applySnapshot(snap: WorldSnapshot): void {
    if (!this.simReady) return;

    this.latestServerTick = snap.serverTick;
    this.latestMatchState = snap.match;

    // Decode base64 → Uint8Array and restore full Rapier world.
    const rapierBytes = base64ToUint8Array(snap.rapierBytesB64);

    // Build an AuthoritativeState and apply it to the local sim.
    // This restores the ball (via rapierBytes) and overwrites player JS fields.
    this.sim.applyAuthoritativeState({
      tick: snap.serverTick,
      players: snap.players.map((p) => ({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        facing: p.facing,
        grounded: p.grounded,
        charge: p.charge,
        knockdownTicks: p.knockdownTicks,
        invulnTicks: p.invulnTicks,
      })),
      ball: snap.ball,
      rapierBytes,
      match: snap.match,
    });

    // In Phase 2: render directly from the restored sim state (no prediction).
    const render = this.sim.getRenderState();
    const prev = this.curRender ?? render;
    this.prevRender = prev;
    this.curRender = render;

    this.cb.onRenderState(prev, render);
    this.cb.onMatchState(snap.match);

    // Trim pending inputs using lastAckedSeq for our slot.
    const ackedForSlot = snap.lastAckedSeq[this.slot] ?? 0;
    this.trimPending(ackedForSlot);
  }

  /** Current render interpolation alpha (accumulator / step). For Phase 3. */
  get renderAlpha(): number {
    return Math.min(1, this.accumulator / FIXED_STEP_MS);
  }

  get currentRender(): RenderState | null {
    return this.curRender;
  }

  get previousRender(): RenderState | null {
    return this.prevRender;
  }
}

// ── Base64 decode (browser + Bun) ─────────────────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
