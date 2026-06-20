/**
 * MatchRoom slot-assignment tests.
 *
 * Tests the slot assignment logic directly without the full Colyseus test
 * harness (which requires @colyseus/tools). The room logic that governs slot
 * assignment is pure JS-object bookkeeping in MatchRoom, so we verify it by
 * calling onJoin / onLeave directly with minimal client stubs.
 */
import { expect, test } from "vitest";
import { MatchRoom } from "../MatchRoom";

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
  (room as unknown as { clients: unknown[] }).clients = [];
  return room;
}

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
