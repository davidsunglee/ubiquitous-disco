/**
 * SimulatedTransport + SnapshotQueue tests (Phase 4).
 *
 * Verifies:
 *  1. Injected downlink latency: messages delivered only after delayMs elapses
 *     (tested via fake performance.now via vi.useFakeTimers()).
 *  2. Drop policy: dropRate=1 silently discards all messages.
 *  3. SnapshotQueue: obsolete snapshots (serverTick <= lastAppliedTick) are
 *     discarded; only the latest tick is applied.
 *  4. SnapshotQueue: with reorder, only the highest serverTick survives drain().
 *  5. Multiple snapshots in flight: after reorder the newest tick wins.
 */

import type { WorldSnapshot } from "@bb/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SimulatedTransport } from "../SimulatedTransport";
import { SnapshotQueue } from "../snapshotQueue";

// ── Minimal mock of NetClient ─────────────────────────────────────────────────

interface FakeNetClient {
  /** Registered message handlers keyed by type. */
  handlers: Map<string, (msg: unknown) => void>;
  /** Messages sent via send(), in order. */
  sent: Array<{ type: string; payload: unknown }>;
  send(type: string, payload: unknown): void;
  onMessage(type: string, cb: (m: unknown) => void): void;
  /** Simulate the server sending a message to this client. */
  receive(type: string, msg: unknown): void;
}

function makeFakeClient(): FakeNetClient {
  const handlers = new Map<string, (msg: unknown) => void>();
  const sent: Array<{ type: string; payload: unknown }> = [];
  return {
    handlers,
    sent,
    send(type, payload) {
      sent.push({ type, payload });
    },
    onMessage(type, cb) {
      handlers.set(type, cb);
    },
    receive(type, msg) {
      const h = handlers.get(type);
      if (h) h(msg);
    },
  };
}

/** Minimal WorldSnapshot with just the fields needed for SnapshotQueue. */
function makeSnap(serverTick: number): WorldSnapshot {
  return {
    type: "WorldSnapshot",
    serverTick,
    players: [],
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    rapierBytesB64: "",
    rngState: 0,
    bellRing: { armed: [], radiusBonus: 0, rampTicks: 0 },
    match: {
      phase: "preRound",
      scores: [0, 0],
      timer: 0,
      pauseTicks: 0,
      resetTicks: 0,
      winner: -1,
      timerExpired: false,
    },
    lastAckedSeq: [0, 0, 0, 0],
  };
}

// ── SnapshotQueue tests ───────────────────────────────────────────────────────

describe("SnapshotQueue", () => {
  test("drain returns null when empty", () => {
    const q = new SnapshotQueue();
    expect(q.drain()).toBeNull();
  });

  test("drain returns pushed snapshot and advances appliedTick", () => {
    const q = new SnapshotQueue();
    const snap = makeSnap(10);
    q.push(snap);
    const drained = q.drain();
    expect(drained?.serverTick).toBe(10);
    expect(q.appliedTick).toBe(10);
    // Second drain returns null.
    expect(q.drain()).toBeNull();
  });

  test("obsolete snapshot (tick <= lastAppliedTick) is discarded", () => {
    const q = new SnapshotQueue();
    q.push(makeSnap(10));
    q.drain(); // appliedTick = 10

    // Push an older snapshot — should be dropped.
    q.push(makeSnap(8));
    expect(q.drain()).toBeNull();

    // Push one at the same tick as lastApplied — should be dropped.
    q.push(makeSnap(10));
    expect(q.drain()).toBeNull();
  });

  test("when multiple snapshots arrive, only the latest tick survives", () => {
    const q = new SnapshotQueue();
    q.push(makeSnap(5));
    q.push(makeSnap(12));
    q.push(makeSnap(8)); // older than pending 12 — discarded
    const drained = q.drain();
    expect(drained?.serverTick).toBe(12);
  });

  test("after drain, obsolete follow-ups are dropped", () => {
    const q = new SnapshotQueue();
    q.push(makeSnap(20));
    q.drain(); // appliedTick=20

    q.push(makeSnap(15)); // obsolete
    q.push(makeSnap(19)); // obsolete
    expect(q.drain()).toBeNull();

    q.push(makeSnap(21)); // valid
    expect(q.drain()?.serverTick).toBe(21);
  });

  test("reset() clears state", () => {
    const q = new SnapshotQueue();
    q.push(makeSnap(10));
    q.drain();
    q.reset();
    expect(q.appliedTick).toBe(0);
    // Can now push tick 5 (which was obsolete before reset).
    q.push(makeSnap(5));
    expect(q.drain()?.serverTick).toBe(5);
  });
});

// ── SimulatedTransport: drop tests (no fake timers) ──────────────────────────

describe("SimulatedTransport: drop policy", () => {
  test("dropRate=0 delivers all messages", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.downlink.delayMs = 0;
    transport.downlink.dropRate = 0;

    const received: unknown[] = [];
    transport.onMessage("WorldSnapshot", (m) => received.push(m));

    client.receive("WorldSnapshot", makeSnap(1));
    client.receive("WorldSnapshot", makeSnap(2));

    // With delayMs=0, messages should be ready at the same performance.now().
    // Call tick() to flush.
    transport.tick();

    expect(received.length).toBe(2);
  });

  test("dropRate=1 drops all messages", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.downlink.delayMs = 0;
    transport.downlink.dropRate = 1;

    const received: unknown[] = [];
    transport.onMessage("WorldSnapshot", (m) => received.push(m));

    client.receive("WorldSnapshot", makeSnap(1));
    client.receive("WorldSnapshot", makeSnap(2));
    transport.tick();

    expect(received.length).toBe(0);
  });
});

// ── SimulatedTransport: latency via fake timers ───────────────────────────────

describe("SimulatedTransport: downlink latency", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("message with 40ms delay is not delivered before 40ms", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.downlink.delayMs = 40;
    transport.downlink.jitterMs = 0;
    transport.downlink.dropRate = 0;

    const received: unknown[] = [];
    transport.onMessage("WorldSnapshot", (m) => received.push(m));

    // Server sends a message at t=0.
    client.receive("WorldSnapshot", makeSnap(1));

    // Advance time by 20ms — should not be delivered yet.
    vi.advanceTimersByTime(20);
    transport.tick();
    expect(received.length).toBe(0);

    // Advance to t=40ms — now it should fire.
    vi.advanceTimersByTime(20);
    transport.tick();
    expect(received.length).toBe(1);
  });

  test("message with 40ms delay is delivered after 40ms", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.downlink.delayMs = 40;
    transport.downlink.jitterMs = 0;
    transport.downlink.dropRate = 0;

    const received: unknown[] = [];
    transport.onMessage("WorldSnapshot", (m) => received.push(m));

    client.receive("WorldSnapshot", makeSnap(5));

    // Advance past the delay.
    vi.advanceTimersByTime(50);
    transport.tick();

    expect(received.length).toBe(1);
    expect((received[0] as WorldSnapshot).serverTick).toBe(5);
  });

  test("uplink delay: send is not forwarded to inner before delay elapses", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.uplink.delayMs = 30;
    transport.uplink.jitterMs = 0;
    transport.uplink.dropRate = 0;

    transport.send("PlayerInput", { seq: 1 });

    // Before delay: inner.sent is empty.
    vi.advanceTimersByTime(10);
    transport.tick();
    expect(client.sent.length).toBe(0);

    // After delay: inner.send is called.
    vi.advanceTimersByTime(30);
    transport.tick();
    expect(client.sent.length).toBe(1);
    expect(client.sent[0]?.type).toBe("PlayerInput");
  });

  test("two messages with equal delay are delivered in order", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.downlink.delayMs = 20;
    transport.downlink.jitterMs = 0;
    transport.downlink.dropRate = 0;

    const ticks: number[] = [];
    transport.onMessage("WorldSnapshot", (m) =>
      ticks.push((m as WorldSnapshot).serverTick),
    );

    client.receive("WorldSnapshot", makeSnap(3));
    client.receive("WorldSnapshot", makeSnap(5));

    vi.advanceTimersByTime(30);
    transport.tick();

    // Both should arrive; order by at-time (equal delay → order of push).
    expect(ticks.length).toBe(2);
    expect(ticks[0]).toBe(3);
    expect(ticks[1]).toBe(5);
  });
});

// ── Integration: SimulatedTransport + SnapshotQueue (reorder → latest wins) ──

describe("SimulatedTransport + SnapshotQueue: reorder resolves to newest tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("out-of-order deliveries: SnapshotQueue keeps only the newest tick", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    // Both messages have the same delay (no reorder sim needed — just test queue).
    transport.downlink.delayMs = 20;
    transport.downlink.jitterMs = 0;
    transport.downlink.dropRate = 0;

    const queue = new SnapshotQueue();
    transport.onMessage("WorldSnapshot", (m) => queue.push(m as WorldSnapshot));

    // Simulate out-of-order arrival: tick=10 arrives, then tick=8 arrives (old).
    client.receive("WorldSnapshot", makeSnap(10));
    client.receive("WorldSnapshot", makeSnap(8));

    vi.advanceTimersByTime(30);
    transport.tick();

    // Queue should have only the newest (tick=10) since 8 < 10.
    const drained = queue.drain();
    expect(drained?.serverTick).toBe(10);
    // The old one (tick=8) should have been discarded.
    expect(queue.drain()).toBeNull();
  });

  test("snapshot queue drops tick=8 after applying tick=10", () => {
    const queue = new SnapshotQueue();
    queue.push(makeSnap(10));
    queue.drain(); // appliedTick=10

    // Now a delayed/reordered old snapshot arrives.
    queue.push(makeSnap(8));
    const result = queue.drain();
    // Should be null — tick 8 <= lastAppliedTick 10.
    expect(result).toBeNull();
  });
});

// ── SimulatedTransport: applyPatch / getParams ───────────────────────────────

describe("SimulatedTransport: applyPatch and getParams", () => {
  test("applyPatch updates uplink and downlink params", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);

    transport.applyPatch({
      uplinkDelayMs: 40,
      uplinkJitterMs: 10,
      uplinkDropRate: 0.05,
      uplinkReorderRate: 0.1,
      downlinkDelayMs: 40,
      downlinkJitterMs: 10,
      downlinkDropRate: 0.05,
      downlinkReorderRate: 0.1,
    });

    const params = transport.getParams();
    expect(params.uplinkDelayMs).toBe(40);
    expect(params.uplinkJitterMs).toBe(10);
    expect(params.uplinkDropRate).toBe(0.05);
    expect(params.downlinkDelayMs).toBe(40);
    expect(params.downlinkJitterMs).toBe(10);
    expect(params.downlinkDropRate).toBe(0.05);
  });

  test("partial patch only updates specified fields", () => {
    const client = makeFakeClient();
    const transport = new SimulatedTransport(client as never);
    transport.uplink.delayMs = 20;

    transport.applyPatch({ uplinkDelayMs: 80 });

    expect(transport.getParams().uplinkDelayMs).toBe(80);
    // Other fields remain at defaults.
    expect(transport.getParams().uplinkDropRate).toBe(0);
  });
});
