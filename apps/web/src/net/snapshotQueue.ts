/**
 * snapshotQueue — Phase 4: "prefer latest, drop obsolete" policy.
 *
 * The network simulator can reorder and delay WorldSnapshot messages. Without
 * a guard, an old snapshot arriving late (tick <= lastAppliedTick) would roll
 * the sim backward and corrupt prediction. This module ensures:
 *
 *   - A snapshot with serverTick <= lastAppliedTick is silently discarded.
 *   - Only the latest snapshot (highest serverTick) is ever applied.
 *
 * Usage (in NetLoop):
 *   const queue = new SnapshotQueue();
 *   // When a WorldSnapshot arrives from the transport:
 *   queue.push(snap);
 *   // Once per tick, drain the queue:
 *   const latest = queue.drain();
 *   if (latest) this.applySnapshot(latest);
 */

import type { WorldSnapshot } from "@bb/protocol";

export class SnapshotQueue {
  /**
   * The highest serverTick that has been applied so far.
   * Snapshots at or below this tick are discarded as obsolete.
   */
  private lastAppliedTick = 0;

  /** Highest-tick snapshot waiting to be applied (at most one at any time). */
  private pending: WorldSnapshot | null = null;

  /**
   * Enqueue a snapshot. Obsolete snapshots (tick <= lastAppliedTick) are
   * dropped immediately. Among multiple arrivals before the next drain(),
   * only the highest serverTick is kept.
   */
  push(snap: WorldSnapshot): void {
    if (snap.serverTick <= this.lastAppliedTick) {
      // Obsolete: discard.
      return;
    }
    if (this.pending === null || snap.serverTick > this.pending.serverTick) {
      this.pending = snap;
    }
    // If the new snap is older than the already-pending one, discard the new one.
  }

  /**
   * Consume the pending snapshot (if any) and advance lastAppliedTick.
   * Returns null if no snapshot is pending.
   *
   * Call once per game tick. The returned snapshot is guaranteed to have
   * serverTick > lastAppliedTick (i.e., newer than any previously applied).
   */
  drain(): WorldSnapshot | null {
    if (this.pending === null) return null;
    const snap = this.pending;
    this.pending = null;
    this.lastAppliedTick = snap.serverTick;
    return snap;
  }

  /**
   * Inspect the pending snapshot without consuming it.
   * Returns null if no snapshot is pending.
   */
  peek(): WorldSnapshot | null {
    return this.pending;
  }

  /** The last serverTick that was applied (used for testing). */
  get appliedTick(): number {
    return this.lastAppliedTick;
  }

  /** Reset state (e.g., on reconnect or sim reset). */
  reset(): void {
    this.pending = null;
    this.lastAppliedTick = 0;
  }
}
