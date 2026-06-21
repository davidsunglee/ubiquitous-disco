/**
 * Per-slot ordered, dedup-by-seq playout buffer (jitter buffer).
 *
 * Implements the Phase-0 time/clock model:
 *  - push(frames): inserts SeqInput entries with seq > lastConsumed, deduplicates,
 *    keeps sorted ascending by seq.
 *  - take(): returns the next input (seq = lastConsumed + 1) and advances
 *    lastConsumed. If no input is available, repeats the last-seen input or
 *    falls back to EMPTY_INPUT (neutral state — the Phase-0 0c model). If a seq
 *    is permanently lost, take() skips it after a bounded hold (see below).
 *  - lastAckedSeq: the seq most recently consumed.
 */

import type { SeqInput } from "@bb/protocol";
import { EMPTY_INPUT, type InputFrame } from "@bb/sim";

// How many ticks to hold (repeat-last) on a gap before skipping a missing seq.
// A few ticks of slack tolerates brief reordering/jitter and gives the client's
// redundant retransmits time to land. Beyond it we MUST advance: the client only
// resends a short tail, so a seq lost past that window never arrives — without a
// skip-ahead, lastConsumed would stick forever, the client's pending list would
// grow without bound, and reconciliation would replay an ever-longer tail.
// 5 ticks ≈ 166ms at 30Hz.
const MAX_HOLD_TICKS = 5;

export class InputBuffer {
  private pending: SeqInput[] = [];
  private lastConsumed = 0;
  private lastInput: InputFrame = { ...EMPTY_INPUT };
  // Consecutive take() calls spent holding on a gap that has buffered data ahead.
  private holdTicks = 0;

  /**
   * Insert new SeqInput frames into the buffer.
   * - Frames with seq <= lastConsumed are stale and discarded.
   * - Duplicate seqs are de-duplicated (first seen wins).
   * - The pending list is kept sorted ascending by seq.
   */
  push(frames: SeqInput[]): void {
    for (const f of frames) {
      // Discard stale (already consumed) and duplicate seqs.
      if (f.seq <= this.lastConsumed) continue;
      if (this.pending.some((p) => p.seq === f.seq)) continue;
      this.pending.push(f);
    }
    // Keep sorted so take() always pulls the lowest seq next.
    this.pending.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Consume the next input in seq order (seq = lastConsumed + 1).
   *
   * If that exact seq is buffered, consume it and advance lastConsumed.
   * Otherwise repeat-last (the "hold" policy from the Phase-0 model) so
   * a brief gap doesn't stall the server. The repeated input is neutral-ish
   * because the client will retransmit the missing seq in the next PlayerInput.
   */
  take(): { input: InputFrame; seq: number } {
    const next = this.pending[0];
    if (next && next.seq === this.lastConsumed + 1) {
      this.consume(next);
      return { input: next.input, seq: next.seq };
    }
    // A gap with buffered data ahead (a missing seq, later seqs already queued):
    // hold briefly for reordering/retransmits, then skip the missing seq so the
    // buffer never deadlocks on a permanently-lost input.
    if (next) {
      this.holdTicks += 1;
      if (this.holdTicks > MAX_HOLD_TICKS) {
        this.consume(next);
        return { input: next.input, seq: next.seq };
      }
    }
    // Gap (no data ahead) or within the hold window: repeat-last, no ack advance.
    // We return lastConsumed so the client knows we haven't moved forward.
    return { input: { ...this.lastInput }, seq: this.lastConsumed };
  }

  /** Advance lastConsumed to a buffered entry and reset the hold counter. */
  private consume(entry: SeqInput): void {
    this.pending.shift();
    this.lastConsumed = entry.seq;
    this.lastInput = entry.input;
    this.holdTicks = 0;
  }

  /** The seq most recently consumed (forwarded to client as lastAckedSeq). */
  get lastAckedSeq(): number {
    return this.lastConsumed;
  }
}
