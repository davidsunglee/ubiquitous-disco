/**
 * Per-slot ordered, dedup-by-seq playout buffer (jitter buffer).
 *
 * Implements the Phase-0 time/clock model:
 *  - push(frames): inserts SeqInput entries with seq > lastConsumed, deduplicates,
 *    keeps sorted ascending by seq.
 *  - take(): returns the next input (seq = lastConsumed + 1) and advances
 *    lastConsumed. If no input is available, repeats the last-seen input or
 *    falls back to EMPTY_INPUT (neutral state — the Phase-0 0c model).
 *  - lastAckedSeq: the seq most recently consumed.
 */

import type { SeqInput } from "@bb/protocol";
import { EMPTY_INPUT, type InputFrame } from "@bb/sim";

export class InputBuffer {
  private pending: SeqInput[] = [];
  private lastConsumed = 0;
  private lastInput: InputFrame = { ...EMPTY_INPUT };

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
      this.pending.shift();
      this.lastConsumed = next.seq;
      this.lastInput = next.input;
      return { input: next.input, seq: next.seq };
    }
    // Gap or empty: repeat-last (seq stays unchanged, no ack advance).
    // We return lastConsumed so the client knows we haven't moved forward.
    return { input: { ...this.lastInput }, seq: this.lastConsumed };
  }

  /** The seq most recently consumed (forwarded to client as lastAckedSeq). */
  get lastAckedSeq(): number {
    return this.lastConsumed;
  }
}
