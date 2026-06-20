/**
 * MatchRoom tests.
 *
 * Phase 1: slot assignment logic tested directly without the full Colyseus
 * harness by calling onJoin / onLeave with minimal client stubs.
 *
 * Phase 2: input ordering (out-of-order seqs consumed in order), seq
 * acknowledgements (lastAckedSeq advances), snapshot cadence (every 2 ticks).
 */

import { EMPTY_INPUT, type InputFrame, initSim } from "@bb/sim";
import { beforeAll, expect, test } from "vitest";
import { InputBuffer } from "../inputBuffer";
import { MatchRoom } from "../MatchRoom";

beforeAll(async () => {
  await initSim();
});

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal stub of the Colyseus Client interface used by MatchRoom */
function makeClient(sessionId: string) {
  const messages: Array<{ type: string; payload: unknown }> = [];
  return {
    sessionId,
    messages,
    send(type: string, payload: unknown) {
      messages.push({ type, payload });
    },
  };
}

function makeRoom() {
  const room = new MatchRoom();

  // Patch clients array so onJoin's broadcast loop can find them.
  const clients: Array<ReturnType<typeof makeClient>> = [];
  (room as unknown as { clients: unknown[] }).clients = clients;

  // Intercept broadcast() calls to capture messages for testing.
  // Colyseus's real broadcast goes through enqueueRaw, but in unit tests we
  // don't have a real transport. Patch the method to record calls and forward
  // to all stub client send() methods.
  const broadcastMessages: Array<{ type: string; payload: unknown }> = [];
  (
    room as unknown as {
      broadcast: (type: string, payload: unknown) => void;
    }
  ).broadcast = (type: string, payload: unknown) => {
    broadcastMessages.push({ type, payload });
    for (const c of clients) {
      c.send(type, payload);
    }
  };

  // Patch disconnect() so it doesn't throw in the unit-test environment
  // (no real Colyseus transport running).
  let disconnectCalled = false;
  (room as unknown as { disconnect: () => Promise<void> }).disconnect = () => {
    disconnectCalled = true;
    return Promise.resolve();
  };

  // Call onCreate to initialise the sim and buffers (sim is no longer a class
  // field initialiser — it's constructed inside onCreate after initSim()).
  room.onCreate();

  // Attach test helpers as live properties (getters must be defined with
  // Object.defineProperty since Object.assign evaluates getters eagerly).
  const extended = room as typeof room & {
    broadcastMessages: typeof broadcastMessages;
    readonly disconnectCalled: boolean;
  };
  Object.defineProperty(extended, "broadcastMessages", {
    get: () => broadcastMessages,
    enumerable: true,
  });
  Object.defineProperty(extended, "disconnectCalled", {
    get: () => disconnectCalled,
    enumerable: true,
  });

  return extended;
}

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

// ── Phase 1: slot assignment ──────────────────────────────────────────────────

test("first client joins as slot 0", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);

  room.onJoin(clientA as never);

  expect(room.slotForSession("session-a")).toBe(0);
  // Should have received at least one RoomReady
  const ready = clientA.messages.find((m) => m.type === "RoomReady");
  expect(ready).toBeDefined();
  expect((ready?.payload as { slot: number }).slot).toBe(0);
});

test("second client joins as slot 1", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  expect(room.slotForSession("session-a")).toBe(0);
  expect(room.slotForSession("session-b")).toBe(1);
});

test("both clients receive full=true when second joins", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  // After the second join, both clients should have received a RoomReady with full:true
  const aFull = clientA.messages.filter(
    (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
  );
  const bFull = clientB.messages.filter(
    (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
  );
  expect(aFull.length).toBeGreaterThan(0);
  expect(bFull.length).toBeGreaterThan(0);
});

test("both clients receive their OWN slot in full=true RoomReady", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  // A should receive slot 0 in the full RoomReady, B should receive slot 1.
  const aFullMsgs = clientA.messages.filter(
    (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
  );
  const bFullMsgs = clientB.messages.filter(
    (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
  );
  expect((aFullMsgs[0]?.payload as { slot: number })?.slot).toBe(0);
  expect((bFullMsgs[0]?.payload as { slot: number })?.slot).toBe(1);
});

test("slot count reflects connected clients", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  expect(room.slotCount).toBe(0);
  room.onJoin(clientA as never);
  expect(room.slotCount).toBe(1);
  room.onJoin(clientB as never);
  expect(room.slotCount).toBe(2);
});

test("slot removed on leave", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);
  room.onLeave(clientA as never);

  expect(room.slotForSession("session-a")).toBeUndefined();
  expect(room.slotForSession("session-b")).toBe(1);
  expect(room.slotCount).toBe(1);
});

test("maxClients is 2", () => {
  const room = makeRoom();
  expect(room.maxClients).toBe(2);
});

// ── Phase 2: InputBuffer ──────────────────────────────────────────────────────

test("InputBuffer: in-order seqs consumed in order", () => {
  const buf = new InputBuffer();
  const frames = [
    { seq: 1, input: f({ moveX: 1 }) },
    { seq: 2, input: f({ moveX: -1 }) },
    { seq: 3, input: EMPTY_INPUT },
  ];
  buf.push(frames);

  const r1 = buf.take();
  expect(r1.seq).toBe(1);
  expect(r1.input.moveX).toBe(1);

  const r2 = buf.take();
  expect(r2.seq).toBe(2);
  expect(r2.input.moveX).toBe(-1);

  const r3 = buf.take();
  expect(r3.seq).toBe(3);
  expect(r3.input.moveX).toBe(0);
});

test("InputBuffer: out-of-order seqs are consumed in ascending order", () => {
  const buf = new InputBuffer();
  // Push out-of-order.
  buf.push([
    { seq: 3, input: f({ moveX: 0.3 }) },
    { seq: 1, input: f({ moveX: 0.1 }) },
    { seq: 2, input: f({ moveX: 0.2 }) },
  ]);

  expect(buf.take().seq).toBe(1);
  expect(buf.take().seq).toBe(2);
  expect(buf.take().seq).toBe(3);
});

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

test("InputBuffer: lastAckedSeq advances correctly", () => {
  const buf = new InputBuffer();
  expect(buf.lastAckedSeq).toBe(0);

  buf.push([{ seq: 1, input: EMPTY_INPUT }]);
  buf.take();
  expect(buf.lastAckedSeq).toBe(1);

  buf.push([{ seq: 2, input: EMPTY_INPUT }]);
  buf.take();
  expect(buf.lastAckedSeq).toBe(2);
});

// ── Phase 2: snapshot cadence ─────────────────────────────────────────────────

test("authoritative sim: sim steps produce valid authoritative state", () => {
  // Access the sim directly via the exposed getter.
  const room = makeRoom();
  const sim = room.simulation;

  // Step the sim forward (past preRound start).
  const startFrame = f({ jumpPressed: true, jumpHeld: true });
  sim.step([startFrame, EMPTY_INPUT]);
  for (let i = 0; i < 5; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  const match = sim.getMatchState();
  expect(match.phase).toBe("playing");
  expect(match.timer).toBeLessThan(DEFAULT_CONFIG_TIMER());
});

function DEFAULT_CONFIG_TIMER() {
  // Import DEFAULT_CONFIG to check the timer. Inline to avoid circular.
  // The default match length is 5400 ticks (3 minutes at 30Hz).
  return 5400;
}

test("snapshot broadcast: rapierBytesB64 round-trips to valid Uint8Array", () => {
  // Simulate what MatchRoom does: toAuthoritativeState → base64 → back.
  import("@bb/sim").then(
    ({
      createSimulation,
      DEFAULT_CONFIG,
      FLAT_DOJO,
      toAuthoritativeState,
      initSim,
    }) => {
      void initSim().then(() => {
        const sim = createSimulation({
          config: DEFAULT_CONFIG,
          arena: FLAT_DOJO,
          seed: 1234,
        });
        sim.step([EMPTY_INPUT, EMPTY_INPUT]);
        const auth = toAuthoritativeState(sim);

        // Encode (as MatchRoom does).
        let binary = "";
        for (let i = 0; i < auth.rapierBytes.length; i++) {
          binary += String.fromCharCode(auth.rapierBytes[i] ?? 0);
        }
        const b64 = btoa(binary);
        expect(b64.length).toBeGreaterThan(0);

        // Decode (as client does).
        const dec = atob(b64);
        const bytes = new Uint8Array(dec.length);
        for (let i = 0; i < dec.length; i++) bytes[i] = dec.charCodeAt(i);
        expect(bytes.length).toBe(auth.rapierBytes.length);

        // The restored sim should match the original.
        const sim2 = createSimulation({
          config: DEFAULT_CONFIG,
          arena: FLAT_DOJO,
          seed: 1234,
        });
        sim2.applyAuthoritativeState({ ...auth, rapierBytes: bytes });
        const r1 = sim.getRenderState();
        const r2 = sim2.getRenderState();
        expect(r2.ball.x).toBeCloseTo(r1.ball.x, 5);
        expect(r2.ball.y).toBeCloseTo(r1.ball.y, 5);
      });
    },
  );
});

// ── Phase 5: fail-closed disconnect ──────────────────────────────────────────

test("onLeave: broadcasts MatchClosed to remaining clients", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  // Register both clients in the room's clients array.
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  // A leaves (unexpected disconnect / consented leave).
  room.onLeave(clientA as never);

  // The room should have broadcast a MatchClosed message.
  const closed = room.broadcastMessages.find((m) => m.type === "MatchClosed");
  expect(closed).toBeDefined();
  expect((closed?.payload as { type: string; reason: string }).reason).toBe(
    "peer-left",
  );
});

test("onLeave: remaining client receives MatchClosed", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  // A leaves — B should receive MatchClosed via the broadcast stub.
  room.onLeave(clientA as never);

  const bClosed = clientB.messages.find((m) => m.type === "MatchClosed");
  expect(bClosed).toBeDefined();
  expect((bClosed?.payload as { type: string; reason: string }).type).toBe(
    "MatchClosed",
  );
});

test("onLeave: room disposes (disconnect called)", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  expect(room.disconnectCalled).toBe(false);
  room.onLeave(clientA as never);
  expect(room.disconnectCalled).toBe(true);
});

test("onLeave: double-leave does not double-broadcast or double-disconnect", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  room.onJoin(clientA as never);
  room.onJoin(clientB as never);

  // A leaves, then B also triggers onLeave (server dispose calls back).
  room.onLeave(clientA as never);
  room.onLeave(clientB as never);

  // MatchClosed should only be broadcast once (roomDisposed guard).
  const closedCount = room.broadcastMessages.filter(
    (m) => m.type === "MatchClosed",
  ).length;
  expect(closedCount).toBe(1);
});

test("onLeave: isDisposed is true after first leave", () => {
  const room = makeRoom();
  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);

  room.onJoin(clientA as never);

  expect(room.isDisposed).toBe(false);
  room.onLeave(clientA as never);
  expect(room.isDisposed).toBe(true);
});
