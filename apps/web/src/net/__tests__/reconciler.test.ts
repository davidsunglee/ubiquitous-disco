/**
 * Reconciler tests (Phase 3, jsdom project).
 *
 * Verifies:
 *  1. Acked inputs are discarded from the pending queue after reconciliation.
 *  2. Remaining (unacked) pending inputs are replayed in seq order.
 *  3. Small correction delta is smoothed (not snapped).
 *  4. Large correction delta is snapped immediately.
 *  5. After replay, the reconciled state matches a reference server-stepped sim.
 *
 * Uses @bb/sim directly (requires initSim() in beforeAll) and a synthetic
 * WorldSnapshot built from toAuthoritativeState().
 *
 * NOTE: `atob` is available in jsdom (vitest environment: jsdom per
 * apps/web/vitest.config.ts). The Reconciler uses atob for base64 decode.
 */

import type { WorldSnapshot } from "@bb/protocol";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  type RenderState,
  toAuthoritativeState,
} from "@bb/sim";
import { beforeAll, describe, expect, test } from "vitest";
import { InterpolationBuffer } from "../InterpolationBuffer";
import { type PendingInput, Reconciler } from "../Reconciler";

beforeAll(async () => {
  await initSim();
});

function frame(p: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...p };
}

function newSim() {
  return createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 9999,
  });
}

/** Encode Uint8Array to base64 (node/jsdom compatible). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/** Build a WorldSnapshot from a running sim (mirrors server broadcast). */
function snapshotFromSim(
  sim: ReturnType<typeof newSim>,
  serverTick: number,
  lastAckedSeq: [number, number] = [0, 0],
): WorldSnapshot {
  const auth = toAuthoritativeState(sim);
  return {
    type: "WorldSnapshot",
    serverTick,
    players: auth.players.map((p) => ({
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
    ball: auth.ball,
    rapierBytesB64: uint8ArrayToBase64(auth.rapierBytes),
    match: auth.match,
    lastAckedSeq,
  };
}

describe("Reconciler: pending input management", () => {
  test("acked inputs are discarded from pending queue", () => {
    const sim = newSim();
    // Start match.
    sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const interp = new InterpolationBuffer();
    const correctedStates: Array<{ x: number; y: number }> = [];

    const reconciler = new Reconciler(sim, 0, 1, interp, (_prev, cur) => {
      const p0 = cur.players[0];
      if (p0) correctedStates.push({ x: p0.x, y: p0.y });
    });

    // Register 5 pending inputs with seqs 1..5 and ticks 1..5.
    for (let i = 1; i <= 5; i++) {
      const entry: PendingInput = {
        seq: i,
        tick: i,
        input: frame({ moveX: 1 }),
      };
      reconciler.addPending(entry);
    }

    // Build a snapshot that acks through seq 3 (for slot 0).
    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 3; i++)
      serverSim.step([frame({ moveX: 1 }), EMPTY_INPUT]);

    const snap = snapshotFromSim(serverSim, 5, [3, 0]);
    reconciler.reconcile(snap);

    // After reconciliation: seqs 1–3 should be discarded, seqs 4–5 remain.
    const pending = reconciler.getPending();
    expect(pending.length).toBe(2);
    expect(pending[0]?.seq).toBe(4);
    expect(pending[1]?.seq).toBe(5);
  });

  test("all inputs discarded when lastAckedSeq covers all pending", () => {
    const sim = newSim();
    sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const interp = new InterpolationBuffer();
    const reconciler = new Reconciler(sim, 0, 1, interp, () => {});

    for (let i = 1; i <= 4; i++) {
      reconciler.addPending({ seq: i, tick: i, input: EMPTY_INPUT });
    }

    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 4; i++) serverSim.step([EMPTY_INPUT, EMPTY_INPUT]);

    const snap = snapshotFromSim(serverSim, 4, [4, 0]);
    reconciler.reconcile(snap);

    expect(reconciler.getPending().length).toBe(0);
  });

  test("no inputs discarded when lastAckedSeq is 0", () => {
    const sim = newSim();
    sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const interp = new InterpolationBuffer();
    const reconciler = new Reconciler(sim, 0, 1, interp, () => {});

    for (let i = 1; i <= 3; i++) {
      reconciler.addPending({ seq: i, tick: i, input: EMPTY_INPUT });
    }

    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const snap = snapshotFromSim(serverSim, 1, [0, 0]);
    reconciler.reconcile(snap);

    expect(reconciler.getPending().length).toBe(3);
  });
});

describe("Reconciler: replay produces server-consistent state", () => {
  test("replayed pending inputs match a reference server-stepped sim", () => {
    // Server sim: steps jumpPressed then 5 × moveX=1.
    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    // Server acks through tick 2 (seqs 1-2), so client replays seqs 3-5.
    serverSim.step([frame({ moveX: 1 }), EMPTY_INPUT]); // seq 1
    serverSim.step([frame({ moveX: 1 }), EMPTY_INPUT]); // seq 2
    // Snapshot here (server has consumed seqs 1-2, acks 2).
    const snapTick = 3; // server tick
    const snap = snapshotFromSim(serverSim, snapTick, [2, 0]);

    // Client sim: starts identically, then has pending seqs 3-5.
    const clientSim = newSim();
    const interp = new InterpolationBuffer();

    // Capture into an array so TS doesn't narrow a `let` to its initializer
    // (it can't see the closure assignment).
    const captures: RenderState[] = [];
    // Use smoothFactor: 1.0 so corrections are applied instantly (no smoothing
    // offset) — this lets us verify pure replay correctness without smoothing noise.
    const reconciler = new Reconciler(
      clientSim,
      0,
      1,
      interp,
      (_prev, cur) => {
        captures.push(cur);
      },
      { smoothFactor: 1.0, snapThreshold: 100 },
    );

    // Pending inputs: seqs 3, 4, 5 (not yet acked).
    for (let s = 3; s <= 5; s++) {
      reconciler.addPending({ seq: s, tick: s, input: frame({ moveX: 1 }) });
    }
    reconciler.setDisplayedRender(clientSim.getRenderState());

    reconciler.reconcile(snap);

    // Reference sim: after the snapshot, replay seqs 3-5.
    const refSim = newSim();
    refSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 5; i++) refSim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const refState = refSim.getRenderState();

    // Reconciled state should match the reference sim (same inputs replayed).
    // The callback fires synchronously during reconcile(), so a capture exists.
    const captured = captures.at(-1);
    if (!captured)
      throw new Error("reconciler did not emit a corrected render");
    const p0Client = captured.players[0];
    const p0Ref = refState.players[0];
    if (!p0Client || !p0Ref) throw new Error("Missing player 0");

    // Positions should be close (smoothing may offset slightly but should
    // converge within tolerance).
    expect(p0Client.x).toBeCloseTo(p0Ref.x, 2);
    expect(p0Client.y).toBeCloseTo(p0Ref.y, 2);
  });
});

describe("Reconciler: smooth vs snap correction", () => {
  test("small position error is smoothed (correctedX between displayed and replayed)", () => {
    const clientSim = newSim();
    clientSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const interp = new InterpolationBuffer();
    let correctedX: number | undefined;

    const reconciler = new Reconciler(
      clientSim,
      0,
      1,
      interp,
      (_prev, cur) => {
        correctedX = cur.players[0]?.x;
      },
      { snapThreshold: 2.0, smoothFactor: 0.3 },
    );

    // Displayed render: player at x=0.0 (initial spawn is x≈-4 in FLAT_DOJO,
    // but we use the sim's actual render state after start).
    const displayedRender = clientSim.getRenderState();
    reconciler.setDisplayedRender(displayedRender);

    // Build a snapshot whose player 0 is slightly displaced (0.5 world units).
    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    // Move the server's player 0 very slightly by stepping one extra frame.
    serverSim.step([frame({ moveX: 0.05 }), EMPTY_INPUT]);
    const snap = snapshotFromSim(serverSim, 2, [0, 0]);

    reconciler.reconcile(snap);

    // The correction should have been applied smoothly: correctedX should be
    // between the displayed x and the replayed x (not snapped to replayed).
    const displayedX = displayedRender.players[0]?.x ?? 0;
    const replayedX = snap.players[0]?.x ?? 0;

    expect(correctedX).not.toBeUndefined();

    // For a small error (< snapThreshold=2.0), smoothing is applied.
    // The corrected value should lie between displayed and replayed.
    const dist = Math.abs(replayedX - displayedX);
    if (dist < 2.0 && dist > 0.001) {
      // Smoothing: the correction should be closer to displayedX than replayedX.
      expect(Math.abs((correctedX ?? 0) - displayedX)).toBeLessThan(
        Math.abs(replayedX - displayedX),
      );
    }
  });

  test("large position error is snapped (correctedX equals replayed x)", () => {
    const clientSim = newSim();
    clientSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

    const interp = new InterpolationBuffer();
    let correctedX: number | undefined;

    const reconciler = new Reconciler(
      clientSim,
      0,
      1,
      interp,
      (_prev, cur) => {
        correctedX = cur.players[0]?.x;
      },
      { snapThreshold: 0.5, smoothFactor: 0.3 }, // very tight snap threshold
    );

    // Set displayed render to the initial state.
    const displayedRender = clientSim.getRenderState();
    reconciler.setDisplayedRender(displayedRender);

    // Build a snapshot with a large displacement (server player at x=2.0 far from spawn).
    const serverSim = newSim();
    serverSim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    // Walk the server player far to the right.
    for (let i = 0; i < 30; i++)
      serverSim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const snap = snapshotFromSim(serverSim, 31, [0, 0]);

    reconciler.reconcile(snap);

    // With snap threshold 0.5 and large error, the result should be snapped.
    const replayedX = snap.players[0]?.x ?? 0;
    // No pending inputs were replayed (all discarded / none added), so the
    // replayed state is exactly the server's authoritative position.
    expect(correctedX).not.toBeUndefined();

    // After snapping, the corrected position should match the replayed exactly.
    expect(Math.abs((correctedX ?? 0) - replayedX)).toBeLessThan(0.01);
  });
});
