/**
 * InputBuffer behavioural / characterization tests.
 *
 * Dedicated coverage for the per-slot ordered, dedup-by-seq playout buffer
 * (jitter buffer) in ../inputBuffer. These tests were previously embedded in
 * matchRoom.test.ts; they live in their own file so the coverage survives
 * future matchRoom.test.ts rewrites.
 *
 * NOTE: the three "in-order seqs consumed in order", "out-of-order seqs are
 * consumed in ascending order", and "lastAckedSeq advances correctly" cases
 * remain in matchRoom.test.ts and are intentionally NOT duplicated here.
 */

import { EMPTY_INPUT, type InputFrame } from "@bb/sim";
import { expect, test } from "vitest";
import { InputBuffer } from "../inputBuffer";

/** Build an InputFrame from a partial patch over the neutral EMPTY_INPUT. */
function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

test("InputBuffer: stale seqs (≤ lastConsumed) are discarded", () => {
  const buf = new InputBuffer();
  buf.push([{ seq: 1, input: EMPTY_INPUT }]);
  buf.take(); // consumes seq 1, lastConsumed = 1

  // Push stale seqs.
  buf.push([
    { seq: 0, input: f({ moveX: 1 }) }, // very stale
    { seq: 1, input: f({ moveX: 2 }) }, // already consumed
    { seq: 2, input: f({ moveX: 3 }) }, // fresh
  ]);

  const r = buf.take();
  expect(r.seq).toBe(2);
  expect(r.input.moveX).toBe(3);
});

test("InputBuffer: duplicate seqs are de-duplicated (first wins)", () => {
  const buf = new InputBuffer();
  buf.push([
    { seq: 1, input: f({ moveX: 0.1 }) },
    { seq: 1, input: f({ moveX: 0.9 }) }, // duplicate — should be ignored
  ]);

  const r = buf.take();
  expect(r.seq).toBe(1);
  expect(r.input.moveX).toBeCloseTo(0.1);
});

test("InputBuffer: take() on empty buffer repeats last input", () => {
  const buf = new InputBuffer();
  // No input pushed — should return neutral (EMPTY_INPUT copy).
  const r = buf.take();
  expect(r.seq).toBe(0);
  expect(r.input.moveX).toBe(0);
  expect(r.input.jumpHeld).toBe(false);
});

test("InputBuffer: take() with gap repeats last known input", () => {
  const buf = new InputBuffer();
  buf.push([{ seq: 1, input: f({ moveX: 1, jumpHeld: true }) }]);
  const r1 = buf.take(); // seq 1
  expect(r1.seq).toBe(1);

  // seq 2 is missing — take() should repeat seq 1's input.
  const r2 = buf.take();
  expect(r2.seq).toBe(1); // lastConsumed didn't advance
  expect(r2.input.moveX).toBe(1);
  expect(r2.input.jumpHeld).toBe(true);
});

test("InputBuffer: a permanently-missing seq does not stall the buffer forever", () => {
  const buf = new InputBuffer();
  buf.push([{ seq: 1, input: f({ moveX: 1 }) }]);
  expect(buf.take().seq).toBe(1); // consume seq 1, lastConsumed = 1

  // seq 2 is permanently lost; later seqs keep arriving and pile up.
  buf.push([
    { seq: 3, input: f({ moveX: 1 }) },
    { seq: 4, input: f({ moveX: 1 }) },
  ]);

  // The first hold still repeats-last so brief reordering/jitter is tolerated.
  expect(buf.take().seq).toBe(1);

  // But the buffer must not deadlock: within a bounded number of ticks it skips
  // the missing seq 2 and advances to the buffered seq 3, then seq 4. Without a
  // skip-ahead policy, take() repeats seq 1 forever and lastAckedSeq never moves.
  let advanced = -1;
  for (let i = 0; i < 30; i++) {
    const r = buf.take();
    if (r.seq >= 3) {
      advanced = r.seq;
      break;
    }
  }
  expect(advanced).toBe(3);
  expect(buf.lastAckedSeq).toBe(3);
  expect(buf.take().seq).toBe(4);
});
