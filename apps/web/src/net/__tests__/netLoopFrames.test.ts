/**
 * buildRedundantFrames tests (Phase 3, jsdom project).
 *
 * The PlayerInput message carries the current frame plus the last few unacked
 * frames so a short uplink-loss burst can be recovered without stalling the
 * server's playout buffer. The redundancy must be `current + MAX_REDUNDANT`
 * frames — an off-by-one that ships `current + (MAX_REDUNDANT - 1)` silently
 * narrows the loss window.
 */

import type { SeqInput } from "@bb/protocol";
import { EMPTY_INPUT } from "@bb/sim";
import { expect, test } from "vitest";
import { buildRedundantFrames } from "../NetLoop";

function seqs(pending: SeqInput[]): number[] {
  return pending.map((f) => f.seq);
}

function pendingOf(...n: number[]): SeqInput[] {
  return n.map((seq) => ({ seq, input: EMPTY_INPUT }));
}

test("sends the current frame plus the last 3 unacked (4 frames total)", () => {
  // pending tail after pushing the current frame (seq 5).
  const frames = buildRedundantFrames(pendingOf(1, 2, 3, 4, 5), 3);
  // current (5) + last 3 unacked (4, 3, 2).
  expect(seqs(frames)).toEqual([2, 3, 4, 5]);
});

test("sends everything when fewer than maxRedundant+1 frames are pending", () => {
  const frames = buildRedundantFrames(pendingOf(1, 2), 3);
  expect(seqs(frames)).toEqual([1, 2]);
});

test("a single pending frame yields just that frame", () => {
  const frames = buildRedundantFrames(pendingOf(7), 3);
  expect(seqs(frames)).toEqual([7]);
});
