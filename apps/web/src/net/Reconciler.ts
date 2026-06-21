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

import { base64ToUint8Array, type WorldSnapshot } from "@bb/protocol";
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

/** One pending (unacked) local input, identified by its seq. */
export interface PendingInput {
  seq: number;
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
      // snap.players is slot-indexed and may be sparse: an inactive slot
      // serializes to `null` (JSON.stringify of a sparse array). Preserve the
      // null so slot indexing is kept; applyAuthoritativeState() skips it.
      players: snap.players.map((p) =>
        p
          ? {
              x: p.x,
              y: p.y,
              vx: p.vx,
              vy: p.vy,
              facing: p.facing,
              grounded: p.grounded,
              charge: p.charge,
              knockdownTicks: p.knockdownTicks,
              invulnTicks: p.invulnTicks,
            }
          : p,
      ),
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
    //
    //    The interp buffer is keyed by the server's tick clock, so the sample
    //    tick MUST be derived from snap.serverTick — NOT from the input's
    //    free-running client localTick (which shares no origin or rate with
    //    serverTick and would clamp every lookup to the buffer's oldest/newest
    //    entry). After applying authoritative state at snap.serverTick, the i-th
    //    replayed input advances the sim to serverTick + i, and the remote is
    //    rendered interpDelayTicks behind that, exactly as live prediction does.
    let replayTick = snap.serverTick;
    for (const p of this.pending) {
      replayTick += 1;
      const remotePose = this.interp.positionAtTick(
        replayTick - this.cfg.interpDelayTicks,
      );
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
   * Within `snapThreshold`: ease the displayed position a `smoothFactor`
   * fraction toward the authoritative (replayed) position. The displayed render
   * is reused as the next frame's baseline, so repeated snapshots converge
   * geometrically; the render loop lerps prev→cur between snapshots, so the
   * visible motion stays smooth without per-frame state here.
   *
   * Beyond `snapThreshold`: teleport directly to the replayed position (snap).
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

      // Error from displayed (what's on screen) to replayed (server truth).
      const errX = rp.x - dp.x;
      const errY = rp.y - dp.y;
      const dist = Math.sqrt(errX * errX + errY * errY);

      // Large error: snap straight to the authoritative position.
      if (dist > this.cfg.snapThreshold) return { ...rp };

      // Small error: move `smoothFactor` of the way toward authoritative.
      return {
        ...rp,
        x: dp.x + errX * this.cfg.smoothFactor,
        y: dp.y + errY * this.cfg.smoothFactor,
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
