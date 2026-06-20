/**
 * Reconciler — Phase 3
 *
 * On each incoming WorldSnapshot:
 *  1. Apply the authoritative state to the local sim (rapierBytes restore path).
 *  2. Discard any pending inputs whose seq ≤ lastAckedSeq[localSlot].
 *  3. Replay the remaining unacked pending inputs in seq order, feeding the
 *     matching historical remote position per tick (Design 0d) so that
 *     ball↔remote collisions during replay use realistic positions.
 *  4. Compute the correction delta between the newly replayed state and the
 *     currently displayed render state.
 *  5. Apply smooth-or-snap correction based on the configured thresholds.
 *
 * The corrected render state is pushed back into NetLoop's prev/cur via the
 * `onCorrectedState` callback so the next render frame uses it.
 */

import type { WorldSnapshot } from "@bb/protocol";
import {
  type AuthoritativeState,
  EMPTY_INPUT,
  type InputFrame,
  type RenderState,
  type Simulation,
} from "@bb/sim";
import {
  type CorrectionConfig,
  DEFAULT_CORRECTION_CONFIG,
} from "./correctionConfig";
import type { InterpolationBuffer } from "./InterpolationBuffer";

/** One pending (unacked) local input with its local tick and seq. */
export interface PendingInput {
  seq: number;
  /** The server tick this input corresponds to (for interp buffer lookup). */
  tick: number;
  input: InputFrame;
}

function distance2D(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export class Reconciler {
  private cfg: CorrectionConfig;

  /** Pending (unacked) inputs for the local slot, in seq order. */
  private pending: PendingInput[] = [];

  /** The currently displayed (possibly smoothed) render state. */
  private displayedRender: RenderState | null = null;

  /**
   * Per-player smooth-correction offset. When a small correction arrives,
   * this offset absorbs the delta and decays toward zero over frames.
   * Index = slot, value = { dx, dy } remaining error still being smoothed.
   */
  private smoothOffset: Array<{ dx: number; dy: number }> = [];

  constructor(
    private readonly sim: Simulation,
    private readonly localSlot: number,
    private readonly remoteSlot: number,
    private readonly interp: InterpolationBuffer,
    private readonly onCorrectedState: (
      prev: RenderState,
      cur: RenderState,
    ) => void,
    cfg: Partial<CorrectionConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_CORRECTION_CONFIG, ...cfg };
  }

  /** Replace the correction config at runtime (for HUD slider tuning). */
  updateConfig(patch: Partial<CorrectionConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  /**
   * Register a new pending input. Called by NetLoop each tick before
   * the local sim.step() so the reconciler has a matching seq/tick record.
   */
  addPending(entry: PendingInput): void {
    this.pending.push(entry);
  }

  /**
   * Update the currently displayed render state (called by NetLoop after
   * each predicted step so the reconciler can diff on the next snapshot).
   */
  setDisplayedRender(render: RenderState): void {
    this.displayedRender = render;
  }

  /**
   * Main reconciliation loop. Called by NetLoop each time a WorldSnapshot
   * arrives from the server.
   *
   * Returns the corrected render state after replay + smooth/snap.
   */
  reconcile(snap: WorldSnapshot): RenderState {
    // 1. Restore the sim to the authoritative server state.
    const rapierBytes = base64ToUint8Array(snap.rapierBytesB64);
    const authState: AuthoritativeState = {
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
    };
    this.sim.applyAuthoritativeState(authState);

    // 2. Discard inputs acked by this snapshot.
    const ackedSeq = snap.lastAckedSeq[this.localSlot] ?? 0;
    this.pending = this.pending.filter((p) => p.seq > ackedSeq);

    // 3. Replay unacked pending inputs in seq order, driving the remote slot
    //    from the tick-indexed interpolation buffer (Design 0d).
    for (const p of this.pending) {
      const remotePose = this.interp.positionAtTick(p.tick);
      if (remotePose) {
        this.sim.setSlotKinematicPosition(
          this.remoteSlot,
          remotePose.x,
          remotePose.y,
          remotePose.facing,
        );
      }

      // Build the two-slot input array: local slot gets the pending input,
      // remote slot gets EMPTY_INPUT (position is driven kinematically above).
      const frames: InputFrame[] = [];
      frames[this.localSlot] = p.input;
      frames[this.remoteSlot] = EMPTY_INPUT;
      this.sim.step(frames);
    }

    // 4. Get the replayed (corrected) state.
    const replayedState = this.sim.getRenderState();

    // 5. Compute correction and apply smooth/snap.
    const correctedState = this.applyCorrection(replayedState);

    // Notify NetLoop of the new corrected state.
    const prev = this.displayedRender ?? correctedState;
    this.onCorrectedState(prev, correctedState);
    this.displayedRender = correctedState;

    return correctedState;
  }

  /**
   * Apply smooth-or-snap correction for each player slot.
   *
   * For positions within `snapThreshold`: blend the remaining smooth offset
   * toward zero (gradual correction), returning a position between displayed
   * and replayed.
   *
   * For positions beyond `snapThreshold`: teleport directly to the replayed
   * position (snap), resetting the smooth offset.
   *
   * Ball and facing are always taken directly from the replayed state (snapped)
   * since smoothing the ball would create visible disagreement with physics.
   */
  private applyCorrection(replayed: RenderState): RenderState {
    if (!this.displayedRender) return replayed;

    const correctedPlayers = replayed.players.map((rp, s) => {
      if (!rp) return rp;

      const dp = this.displayedRender?.players[s];
      if (!dp) return rp;

      // Initialize smooth offset for this slot if needed.
      if (!this.smoothOffset[s]) {
        this.smoothOffset[s] = { dx: 0, dy: 0 };
      }
      const offset = this.smoothOffset[s] ?? { dx: 0, dy: 0 };

      // The raw error is (replayed - displayed).
      const errX = rp.x - dp.x;
      const errY = rp.y - dp.y;
      const dist = Math.sqrt(errX * errX + errY * errY);

      if (dist > this.cfg.snapThreshold) {
        // Large error: snap immediately and clear the smooth offset.
        this.smoothOffset[s] = { dx: 0, dy: 0 };
        return { ...rp };
      }

      // Small error: accumulate into smooth offset and blend.
      // The displayed position already absorbed previous offsets, so the
      // new total error relative to the replayed position is errX/errY.
      // We move `smoothFactor` of the remaining error each frame.
      offset.dx = errX;
      offset.dy = errY;

      // Decay: the displayed position lags behind replayed by (1-smoothFactor).
      const correctedX = rp.x - offset.dx * (1 - this.cfg.smoothFactor);
      const correctedY = rp.y - offset.dy * (1 - this.cfg.smoothFactor);

      // Decay the offset for next frame.
      offset.dx *= 1 - this.cfg.smoothFactor;
      offset.dy *= 1 - this.cfg.smoothFactor;

      // Clear offset when it's negligible.
      if (Math.abs(offset.dx) < 0.001 && Math.abs(offset.dy) < 0.001) {
        this.smoothOffset[s] = { dx: 0, dy: 0 };
      }

      return {
        ...rp,
        x: correctedX,
        y: correctedY,
      };
    });

    return {
      players: correctedPlayers,
      // Ball position/velocity always taken from replayed state (snapped).
      ball: replayed.ball,
    };
  }

  /**
   * Return the current pending queue (for testing / inspection).
   */
  getPending(): readonly PendingInput[] {
    return this.pending;
  }

  /** Compute the position distance between displayed and replayed for a slot. */
  correctionDistanceForSlot(slot: number, replayed: RenderState): number {
    if (!this.displayedRender) return 0;
    const dp = this.displayedRender.players[slot];
    const rp = replayed.players[slot];
    if (!dp || !rp) return 0;
    return distance2D(dp.x, dp.y, rp.x, rp.y);
  }
}

// ── Base64 decode (browser + Bun compatible) ─────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
