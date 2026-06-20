/**
 * InterpolationBuffer — Phase 3
 *
 * Ring buffer of authoritative remote player snapshots keyed by server tick.
 * Used to:
 *   - Render the remote player ~100ms behind authoritative time (smooth lerp).
 *   - Feed tick-indexed historical positions into the reconciler's replay loop
 *     so ball↔remote collisions during replay use historically-correct positions
 *     (Design 0d).
 *
 * Each entry stores the remote player's position/velocity/facing at a given
 * serverTick as received in a WorldSnapshot.
 *
 * Buffer capacity is capped at MAX_ENTRIES (enough for ~1s of 15Hz snapshots
 * + some headroom). Entries older than MAX_ENTRIES are evicted on push.
 */

/** One authoritative remote position entry keyed by server tick. */
export interface RemotePose {
  serverTick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
}

/** Lerp a scalar value between a and b by t ∈ [0,1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const MAX_ENTRIES = 60; // ~4s at 15Hz snapshots

export class InterpolationBuffer {
  private entries: RemotePose[] = [];

  /**
   * Record a new authoritative pose. Duplicate ticks are ignored (last-write
   * wins for equal tick); entries are always stored in ascending tick order.
   */
  push(pose: RemotePose): void {
    // Drop duplicates (server resends are idempotent).
    const existing = this.entries.findIndex(
      (e) => e.serverTick === pose.serverTick,
    );
    if (existing >= 0) {
      this.entries[existing] = pose;
      return;
    }

    // Insert in ascending tick order.
    let insertAt = this.entries.length;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if ((this.entries[i]?.serverTick ?? 0) < pose.serverTick) {
        insertAt = i + 1;
        break;
      }
      insertAt = i;
    }
    this.entries.splice(insertAt, 0, pose);

    // Evict oldest entries beyond the cap.
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
  }

  /**
   * Sample the remote player position at `renderTick` by lerping between the
   * two closest bracketing entries. Used for rendering.
   *
   * - If renderTick is before the first entry, returns the first entry.
   * - If renderTick is after the last entry, returns the last entry.
   * - If the buffer is empty, returns null.
   */
  sample(renderTick: number): RemotePose | null {
    if (this.entries.length === 0) return null;

    const first = this.entries[0];
    const last = this.entries[this.entries.length - 1];

    if (!first || !last) return null;

    // Before the first entry.
    if (renderTick <= first.serverTick) return { ...first };

    // After the last entry.
    if (renderTick >= last.serverTick) return { ...last };

    // Find the two bracketing entries (prev.tick <= renderTick < next.tick).
    let prevIdx = 0;
    for (let i = 0; i < this.entries.length - 1; i++) {
      const cur = this.entries[i];
      const nxt = this.entries[i + 1];
      if (!cur || !nxt) continue;
      if (cur.serverTick <= renderTick && nxt.serverTick > renderTick) {
        prevIdx = i;
        break;
      }
    }

    const prev = this.entries[prevIdx];
    const next = this.entries[prevIdx + 1];
    if (!prev || !next) return { ...(prev ?? last) };

    const span = next.serverTick - prev.serverTick;
    const t = span > 0 ? (renderTick - prev.serverTick) / span : 0;

    return {
      serverTick: renderTick,
      x: lerp(prev.x, next.x, t),
      y: lerp(prev.y, next.y, t),
      vx: lerp(prev.vx, next.vx, t),
      vy: lerp(prev.vy, next.vy, t),
      // Facing snaps (no lerp for discrete values) — use next if t >= 0.5.
      facing: t >= 0.5 ? next.facing : prev.facing,
    };
  }

  /**
   * Return the nearest entry at or before `tick` (for reconciler replay, 0d).
   * Returns null if the buffer is empty or all entries are after `tick`.
   *
   * During replay, each pending tick N needs the remote position "as of tick N"
   * — the closest authoritative snapshot at or before N.
   */
  positionAtTick(tick: number): RemotePose | null {
    if (this.entries.length === 0) return null;

    // Walk from newest to oldest to find the last entry whose serverTick <= tick.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e && e.serverTick <= tick) return { ...e };
    }

    // All entries are after tick — return the oldest as the best approximation.
    const first = this.entries[0];
    return first ? { ...first } : null;
  }

  /** Number of buffered entries (for testing). */
  get size(): number {
    return this.entries.length;
  }

  /** Clear all buffered entries. */
  clear(): void {
    this.entries = [];
  }
}
