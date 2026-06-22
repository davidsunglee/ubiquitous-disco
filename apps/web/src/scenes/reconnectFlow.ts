/**
 * reconnectFlow — pure reconnect-decision logic + single-registration fail-closed
 * wiring, extracted from GameScene so the bug-prone parts are unit-testable
 * without standing up Phaser.
 *
 * Background (FLI-8): the Colyseus SDK STACKS handlers — `room.onMessage`,
 * `room.onLeave.once`, and `room.onError.once` all append rather than replace.
 * NetClient.onFailClosed() registers all three internally, so calling it twice
 * on the SAME room wires two independent fire-once chains that BOTH fire on a
 * disconnect. These helpers centralise the reconnect decision and guarantee a
 * given NetClient instance is wired for fail-closed exactly once.
 */

import type { MatchClosed } from "@bb/protocol";

/** A fail-closed reason as surfaced by NetClient.onFailClosed. */
export type FailClosedReason = MatchClosed["reason"] | "ws-error";

/** Reasons that are terminal — no reconnect should be attempted. */
const TERMINAL_REASONS: ReadonlySet<FailClosedReason> = new Set([
  "reconnect-expired",
  "server-shutdown",
]);

export interface ReconnectDecisionState {
  /** Whether a launch payload is retained for re-joining. */
  hasRetainedLaunch: boolean;
  /** Whether a reconnect attempt is already in flight. */
  reconnecting: boolean;
}

/**
 * The reconnect-decision predicate: should we attempt a silent reconnect in
 * response to this fail-closed reason?
 *
 * True only when a launch is retained, no reconnect is already in flight, and
 * the reason is not terminal (expired grace or server shutdown).
 */
export function shouldAttemptReconnect(
  reason: FailClosedReason,
  state: ReconnectDecisionState,
): boolean {
  return (
    state.hasRetainedLaunch &&
    !state.reconnecting &&
    !TERMINAL_REASONS.has(reason)
  );
}

/** Minimal shape of the NetClient bits wireFailClosed needs. */
interface FailClosedTarget {
  onFailClosed(cb: (reason: FailClosedReason) => void): void;
}

/**
 * Track which NetClient instances have already had fail-closed wired, so a
 * second wireFailClosed() for the same instance is a no-op. A WeakSet lets the
 * NetClient be GC'd once the scene drops it.
 */
const wired = new WeakSet<object>();

/**
 * Wire a fail-closed handler onto a NetClient EXACTLY ONCE per instance.
 *
 * Because NetClient.onFailClosed registers stacking SDK handlers, registering
 * twice on the same room would make both fire on every disconnect (BUG #1). A
 * fresh NetClient (e.g. built by attemptReconnect) wires legitimately because
 * it is a different instance.
 */
export function wireFailClosed(
  net: FailClosedTarget,
  cb: (reason: FailClosedReason) => void,
): void {
  if (wired.has(net)) return;
  wired.add(net);
  net.onFailClosed(cb);
}
