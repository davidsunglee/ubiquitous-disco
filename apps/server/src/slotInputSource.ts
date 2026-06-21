/**
 * SlotInputSource — uniform input-source boundary for human and bot slots.
 *
 * Each active Player Slot is backed by exactly one SlotInputSource:
 *  - humanSource(buffer): delegates take() to the InputBuffer (jitter-buffered
 *    human input from PlayerInput messages).
 *  - botSource(slotId, config): calls samplePracticeBotInput() from a
 *    BotWorldView the room builds from authoritative state each tick.
 *
 * Both sources expose the same interface so MatchRoom.tickOnce() can call
 * source.take(view) uniformly without branching on kind.
 *
 * Bot slots always report lastAckedSeq = 0 (they never receive PlayerInput
 * messages, so there is nothing to acknowledge).
 */

import {
  type BotWorldView,
  type InputFrame,
  type PlayerSlotId,
  type SimConfig,
  samplePracticeBotInput,
} from "@bb/sim";
import type { InputBuffer } from "./inputBuffer";

export interface SlotInputSource {
  /** Consume the next input for this tick. The view is used only by bot sources. */
  take(view: BotWorldView): { input: InputFrame; seq: number };
  /** Human: the last consumed seq from the buffer. Bot: always 0. */
  readonly lastAckedSeq: number;
  /** True for human-backed sources (PlayerInput messages are accepted). */
  readonly isHuman: boolean;
}

/** Wrap an InputBuffer as a human SlotInputSource. */
export function humanSource(buffer: InputBuffer): SlotInputSource {
  return {
    take(_view: BotWorldView) {
      return buffer.take();
    },
    get lastAckedSeq() {
      return buffer.lastAckedSeq;
    },
    isHuman: true,
  };
}

/** Create a bot SlotInputSource backed by samplePracticeBotInput. */
export function botSource(
  slotId: PlayerSlotId,
  config: SimConfig,
): SlotInputSource {
  return {
    take(view: BotWorldView) {
      const input = samplePracticeBotInput(slotId, view, config);
      // Bot slots never have real seqs; report seq=0 and lastAckedSeq=0.
      return { input, seq: 0 };
    },
    get lastAckedSeq() {
      return 0;
    },
    isHuman: false,
  };
}
