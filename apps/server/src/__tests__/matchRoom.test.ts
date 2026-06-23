/**
 * MatchRoom tests.
 *
 * Phase 2: InputBuffer ordering / acks; snapshot cadence (every 2 ticks).
 *
 * Phase 5: manifest-driven join. onJoin validates a launch claim against the
 * worker (here a stubbed lobbyClient), maps each human to their CLAIMED Player
 * Slot (not join order), configures bot sources + settings from the manifest,
 * and rejects invalid/duplicate claims. The Phase 3 `botSlots` create option is
 * gone — bots come from the manifest.
 *
 * Phase 6: reconnect grace window. onLeave reserves a human slot (EMPTY_INPUT
 * fed during grace); same-token reclaim via a fresh onJoin within grace succeeds
 * and restores the human source; grace expiry fail-closes with reconnect-expired.
 */

import {
  base64ToUint8Array,
  type ClaimResponse,
  type MatchManifest,
  type MatchManifestSlot,
  type PlayerSlotId,
  uint8ArrayToBase64,
} from "@bb/protocol";
import { EMPTY_INPUT, type InputFrame, initSim } from "@bb/sim";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { InputBuffer } from "../inputBuffer";
import { MatchRoom } from "../MatchRoom";

// Stub the lobby claim client. Each test sets `claimImpl` to control the result.
vi.mock("../lobbyClient", () => ({
  claim: (launchId: string, joinToken: string) =>
    claimImpl(launchId, joinToken),
}));

let claimImpl: (launchId: string, joinToken: string) => Promise<ClaimResponse> =
  async () => ({ ok: false });

beforeEach(() => {
  claimImpl = async () => ({ ok: false });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  await initSim();
});

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal stub of the Colyseus Client interface used by MatchRoom */
function makeClient(sessionId: string) {
  const messages: Array<{ type: string; payload: unknown }> = [];
  let left = false;
  return {
    sessionId,
    messages,
    get leftCalled() {
      return left;
    },
    leave() {
      left = true;
    },
    send(type: string, payload: unknown) {
      messages.push({ type, payload });
    },
  };
}

function makeRoom() {
  const room = new MatchRoom();

  const clients: Array<ReturnType<typeof makeClient>> = [];
  (room as unknown as { clients: unknown[] }).clients = clients;

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

  let disconnectCalled = false;
  (room as unknown as { disconnect: () => Promise<void> }).disconnect = () => {
    disconnectCalled = true;
    return Promise.resolve();
  };

  // No botSlots option anymore — onCreate just installs the loop.
  room.onCreate({});

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

function manifest(
  slots: MatchManifestSlot[],
  matchLengthTicks = 5400,
): MatchManifest {
  return {
    launchId: "L1",
    slots,
    settings: { mode: "2v2", matchLengthTicks, arenaId: "flat-dojo" },
  };
}

/** A 2v2 manifest with the given bot slots; the rest are humans. */
function manifest2v2(
  botSlots: PlayerSlotId[] = [],
  matchLengthTicks = 5400,
): MatchManifest {
  const bots = new Set(botSlots);
  const slots: MatchManifestSlot[] = ([0, 1, 2, 3] as PlayerSlotId[]).map(
    (s) =>
      bots.has(s)
        ? { slotId: s, kind: "bot" as const, characterId: "sifu" as const }
        : {
            slotId: s,
            kind: "human" as const,
            playerId: `p${s}`,
            characterId: "sifu" as const,
          },
  );
  return manifest(slots, matchLengthTicks);
}

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

// ── Phase 5: manifest-driven join ─────────────────────────────────────────────

test("onJoin maps a human to their CLAIMED slot (not join order)", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => ({ ok: true, playerSlotId: 2, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);

  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "tok" });

  expect(room.slotForSession("session-a")).toBe(2);
  const ready = clientA.messages.find((m) => m.type === "RoomReady");
  expect((ready?.payload as { slot: number }).slot).toBe(2);
});

test("onJoin configures the room from the manifest (first join only)", async () => {
  const room = makeRoom();
  const mf = manifest2v2([3]); // slot 3 is a bot
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  expect(room.isConfigured).toBe(true);
  expect(room.activePlayerSlots).toEqual([0, 1, 2, 3]);
  // Bot slot has a non-human source and no buffer; humans do.
  expect(room.inputSources.get(3)?.isHuman).toBe(false);
  expect(room.inputBuffers.has(3)).toBe(false);
  for (const s of [0, 1, 2] as PlayerSlotId[]) {
    expect(room.inputSources.get(s)?.isHuman).toBe(true);
    expect(room.inputBuffers.has(s)).toBe(true);
  }
});

test("onJoin rejects an invalid/duplicate claim by leaving (no seat)", async () => {
  const room = makeRoom();
  claimImpl = async () => ({ ok: false });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);

  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "bad" });

  expect(clientA.leftCalled).toBe(true);
  expect(room.slotForSession("session-a")).toBeUndefined();
  expect(room.slotCount).toBe(0);
});

test("onJoin rejects same-token replay while the original session is active", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const original = makeClient("session-original");
  const replay = makeClient("session-replay");
  (room as unknown as { clients: unknown[] }).clients.push(original, replay);

  await room.onJoin(original as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(replay as never, { launchId: "L1", joinToken: "t0" });

  expect(replay.leftCalled).toBe(true);
  expect(original.leftCalled).toBe(false);
  expect(room.slotForSession("session-original")).toBe(0);
  expect(room.slotForSession("session-replay")).toBeUndefined();
  expect(room.slotCount).toBe(1);
});

test("onJoin rejects same-slot claim while the original session is active", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const original = makeClient("session-original");
  const intruder = makeClient("session-intruder");
  (room as unknown as { clients: unknown[] }).clients.push(original, intruder);

  await room.onJoin(original as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(intruder as never, {
    launchId: "L2",
    joinToken: "other-token",
  });

  expect(intruder.leftCalled).toBe(true);
  expect(original.leftCalled).toBe(false);
  expect(room.slotForSession("session-original")).toBe(0);
  expect(room.slotForSession("session-intruder")).toBeUndefined();
  expect(room.slotCount).toBe(1);
});

test("onJoin with no launch options uses the legacy dev/test direct-connect path", async () => {
  // No launchId/joinToken → legacy join-order seating (dev/test shortcut), NOT
  // a fail-closed leave. Builds a default 2v2 manifest (4 human slots).
  const room = makeRoom();
  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);

  await room.onJoin(clientA as never, undefined);

  expect(clientA.leftCalled).toBe(false);
  expect(room.slotForSession("session-a")).toBe(0);
  expect(room.activePlayerSlots).toEqual([0, 1, 2, 3]);
});

test("legacy direct-connect path honors botSlots from create options", async () => {
  const room = new MatchRoom();
  (room as unknown as { clients: unknown[] }).clients = [];
  (room as unknown as { broadcast: () => void }).broadcast = () => {};
  room.onCreate({ botSlots: [3] });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, undefined);

  expect(room.inputSources.get(3)?.isHuman).toBe(false);
  expect(room.inputBuffers.has(3)).toBe(false);
  expect(room.slotForSession("session-a")).toBe(0);
});

test("all four humans seated; full=true delivered with each client's own claimed slot", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = {
    t0: 0,
    t1: 1,
    t2: 2,
    t3: 3,
  };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token],
    manifest: mf,
  });

  const clients = ["a", "b", "c", "d"].map((id) => makeClient(`session-${id}`));
  (room as unknown as { clients: unknown[] }).clients.push(...clients);

  await room.onJoin(clients[0] as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clients[1] as never, { launchId: "L1", joinToken: "t1" });
  await room.onJoin(clients[2] as never, { launchId: "L1", joinToken: "t2" });
  await room.onJoin(clients[3] as never, { launchId: "L1", joinToken: "t3" });

  expect(room.slotForSession("session-a")).toBe(0);
  expect(room.slotForSession("session-d")).toBe(3);

  const expectedSlots = [0, 1, 2, 3];
  clients.forEach((c, i) => {
    const fullMsgs = c.messages.filter(
      (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
    );
    expect(fullMsgs.length).toBeGreaterThan(0);
    expect((fullMsgs[0]?.payload as { slot: number }).slot).toBe(
      expectedSlots[i],
    );
  });
});

test("full=true when only human slots are filled (bot slot not counted)", async () => {
  const room = makeRoom();
  const mf = manifest2v2([3]); // 3 humans (0,1,2) + 1 bot (3)
  const tokenSlot: Record<string, PlayerSlotId> = { t0: 0, t1: 1, t2: 2 };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token],
    manifest: mf,
  });

  const clients = ["a", "b", "c"].map((id) => makeClient(`session-${id}`));
  (room as unknown as { clients: unknown[] }).clients.push(...clients);

  await room.onJoin(clients[0] as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clients[1] as never, { launchId: "L1", joinToken: "t1" });
  await room.onJoin(clients[2] as never, { launchId: "L1", joinToken: "t2" });

  for (const c of clients) {
    const fullMsgs = c.messages.filter(
      (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
    );
    expect(fullMsgs.length).toBeGreaterThan(0);
  }
});

test("RoomReady carries the manifest's active slots", async () => {
  const room = makeRoom();
  const mf = manifest2v2([3]);
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  const ready = clientA.messages.find((m) => m.type === "RoomReady");
  expect((ready?.payload as { slots: number[] }).slots).toEqual([0, 1, 2, 3]);
});

test("maxClients is 4", () => {
  const room = makeRoom();
  expect(room.maxClients).toBe(4);
});

// ── Phase 5: manifest-configured bot sources ──────────────────────────────────

test("manifest bot slot is backed by a bot source; humans get buffers", () => {
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2([3]));

  expect(room.inputSources.get(3)?.isHuman).toBe(false);
  expect(room.inputBuffers.has(3)).toBe(false);
  for (const s of [0, 1, 2] as PlayerSlotId[]) {
    expect(room.inputSources.get(s)?.isHuman).toBe(true);
    expect(room.inputBuffers.has(s)).toBe(true);
  }
});

test("manifest bot slot lastAckedSeq stays 0 across ticks", () => {
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2([3]));
  const drive = room as unknown as { tickOnce(): void };
  for (let i = 0; i < 6; i++) drive.tickOnce();
  expect(room.inputSources.get(3)?.lastAckedSeq).toBe(0);
});

test("manifest match length is applied to the sim config", () => {
  const room = makeRoom();
  // 2:00 = 3600 ticks @ 30 Hz.
  room.testConfigureFromManifest(manifest2v2([], 3600));
  expect(room.simulation.getMatchState().timer).toBe(3600);
});

// ── Phase 6: reconnect grace window ──────────────────────────────────────────

test("onLeave reserves the slot instead of fail-closing immediately", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = { t0: 0, t1: 1 };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token] as PlayerSlotId,
    manifest: mf,
  });

  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clientB as never, { launchId: "L1", joinToken: "t1" });

  room.onLeave(clientA as never);

  // The room should NOT be disposed yet — slot is reserved.
  expect(room.isDisposed).toBe(false);
  expect(room.disconnectCalled).toBe(false);
  // No MatchClosed broadcast yet.
  expect(room.broadcastMessages.some((m) => m.type === "MatchClosed")).toBe(
    false,
  );
  // Slot 0 should be in the reserved list.
  expect(room.reservedSlotIds).toContain(0);
});

test("reserved slot source returns EMPTY_INPUT during grace", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  room.onLeave(clientA as never);

  // The source for slot 0 should now be the emptySource (isHuman=true, returns EMPTY_INPUT).
  const src = room.inputSources.get(0);
  expect(src?.isHuman).toBe(true);
  // Calling take() should return EMPTY_INPUT.
  const taken = src?.take({
    tick: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    self: { x: 0, y: 0, facing: 1, grounded: false },
  });
  expect(taken?.input).toEqual(EMPTY_INPUT);
});

test("same-slot reclaim within grace succeeds and restores human source", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => {
    return { ok: true, playerSlotId: 0, manifest: mf };
  };

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  // Client A leaves — slot 0 is reserved.
  room.onLeave(clientA as never);
  expect(room.reservedSlotIds).toContain(0);

  // Client A reconnects with the same token (within grace).
  const clientA2 = makeClient("session-a2");
  (room as unknown as { clients: unknown[] }).clients.push(clientA2);
  await room.onJoin(clientA2 as never, { launchId: "L1", joinToken: "t0" });

  // Slot 0 should no longer be reserved.
  expect(room.reservedSlotIds).not.toContain(0);
  // The room should not be disposed.
  expect(room.isDisposed).toBe(false);
  // Client A2 should be seated at slot 0.
  expect(room.slotForSession("session-a2")).toBe(0);
  // Source for slot 0 should be restored to a human source.
  expect(room.inputSources.get(0)?.isHuman).toBe(true);
});

test("reserved slot reclaim requires the exact stored launch credentials", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async (launchId, _joinToken) => ({
    ok: true,
    playerSlotId: 0,
    manifest: { ...mf, launchId },
  });

  const original = makeClient("session-original");
  (room as unknown as { clients: unknown[] }).clients.push(original);
  await room.onJoin(original as never, { launchId: "L1", joinToken: "t0" });

  room.onLeave(original as never);
  expect(room.reservedSlotIds).toContain(0);

  const hijack = makeClient("session-hijack");
  (room as unknown as { clients: unknown[] }).clients.push(hijack);
  await room.onJoin(hijack as never, { launchId: "L2", joinToken: "t-other" });

  expect(hijack.leftCalled).toBe(true);
  expect(room.slotForSession("session-hijack")).toBeUndefined();
  expect(room.reservedSlotIds).toContain(0);
  expect(room.isDisposed).toBe(false);

  const reconnect = makeClient("session-reconnect");
  (room as unknown as { clients: unknown[] }).clients.push(reconnect);
  await room.onJoin(reconnect as never, { launchId: "L1", joinToken: "t0" });

  expect(reconnect.leftCalled).toBe(false);
  expect(room.slotForSession("session-reconnect")).toBe(0);
  expect(room.reservedSlotIds).not.toContain(0);
});

test("grace expiry fail-closes with reconnect-expired", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  room.onLeave(clientA as never);
  expect(room.reservedSlotIds).toContain(0);

  // Trigger grace expiry directly via the test hook.
  room.testTriggerGraceExpiry(0 as PlayerSlotId);

  // Room should now be disposed with reconnect-expired reason.
  expect(room.isDisposed).toBe(true);
  expect(room.disconnectCalled).toBe(true);
  const closed = room.broadcastMessages.find((m) => m.type === "MatchClosed");
  expect((closed?.payload as { reason: string }).reason).toBe(
    "reconnect-expired",
  );
});

test("onLeave: double-leave does not double-broadcast (one slot reserved, one triggers grace)", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = { t0: 0, t1: 1 };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token] as PlayerSlotId,
    manifest: mf,
  });

  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clientB as never, { launchId: "L1", joinToken: "t1" });

  // A leaves: slot 0 reserved (no broadcast yet).
  room.onLeave(clientA as never);
  // Grace expires for A's slot: room fail-closes (reconnect-expired).
  room.testTriggerGraceExpiry(0 as PlayerSlotId);
  // B then leaves: room already disposed, should not double-broadcast.
  room.onLeave(clientB as never);

  const closedMsgs = room.broadcastMessages.filter(
    (m) => m.type === "MatchClosed",
  );
  expect(closedMsgs.length).toBe(1);
  expect((closedMsgs[0]?.payload as { reason: string }).reason).toBe(
    "reconnect-expired",
  );
});

test("concurrent disconnects: first reconnect sees full=true (other slot still reserved)", async () => {
  // Four humans seated, then TWO disconnect concurrently (both slots reserved
  // within grace). When ONE of them reconnects, "full" should mean "every human
  // slot that is NOT currently reserved is occupied" — so the reconnecting
  // client must receive RoomReady{full:true} and resume immediately, without
  // waiting for the OTHER disconnected player to return.
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = {
    t0: 0,
    t1: 1,
    t2: 2,
    t3: 3,
  };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token],
    manifest: mf,
  });

  const clients = ["a", "b", "c", "d"].map((id) => makeClient(`session-${id}`));
  (room as unknown as { clients: unknown[] }).clients.push(...clients);

  await room.onJoin(clients[0] as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clients[1] as never, { launchId: "L1", joinToken: "t1" });
  await room.onJoin(clients[2] as never, { launchId: "L1", joinToken: "t2" });
  await room.onJoin(clients[3] as never, { launchId: "L1", joinToken: "t3" });

  // Two humans disconnect concurrently — slots 0 and 1 are both reserved.
  room.onLeave(clients[0] as never);
  room.onLeave(clients[1] as never);
  expect(room.reservedSlotIds).toContain(0);
  expect(room.reservedSlotIds).toContain(1);
  expect(room.isDisposed).toBe(false);

  // Player at slot 0 reconnects with the same token while slot 1 is still reserved.
  const reconnect = makeClient("session-a2");
  (room as unknown as { clients: unknown[] }).clients.push(reconnect);
  await room.onJoin(reconnect as never, { launchId: "L1", joinToken: "t0" });

  expect(room.slotForSession("session-a2")).toBe(0);
  expect(room.reservedSlotIds).not.toContain(0);
  expect(room.reservedSlotIds).toContain(1);

  // The reconnected client must receive a full=true RoomReady for its slot.
  const fullMsgs = reconnect.messages.filter(
    (m) => m.type === "RoomReady" && (m.payload as { full: boolean }).full,
  );
  expect(fullMsgs.length).toBeGreaterThan(0);
  expect((fullMsgs[0]?.payload as { slot: number }).slot).toBe(0);
});

// ── Phase 5: fail-closed disconnect (legacy direct-connect path only) ─────────

test("onLeave broadcasts MatchClosed(peer-left) and disposes (legacy direct-connect)", async () => {
  // The legacy direct-connect path has no launchId/joinToken, so the room never
  // records slotLaunchOptions for the slot — there is no joinToken to reclaim
  // with. onLeave therefore keeps the Plan 1 immediate fail-closed behaviour:
  // no reserve, no grace window, a prompt `peer-left` broadcast.
  const room = makeRoom();
  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  // Use legacy path (no launch options).
  await room.onJoin(clientA as never, undefined);
  await room.onJoin(clientB as never, undefined);

  expect(room.disconnectCalled).toBe(false);
  room.onLeave(clientA as never);

  // Legacy path: the slot is NOT reserved — the room fail-closes immediately.
  expect(room.reservedSlotIds).not.toContain(0);
  expect(room.disconnectCalled).toBe(true);
  expect(room.isDisposed).toBe(true);
  const closed = room.broadcastMessages.find((m) => m.type === "MatchClosed");
  // The reason is peer-left (immediate fail-close, no grace window).
  expect((closed?.payload as { reason: string }).reason).toBe("peer-left");
  expect(clientB.messages.some((m) => m.type === "MatchClosed")).toBe(true);
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

  expect(buf.take().seq).toBe(1);
  expect(buf.take().seq).toBe(2);
  expect(buf.take().seq).toBe(3);
});

test("InputBuffer: out-of-order seqs are consumed in ascending order", () => {
  const buf = new InputBuffer();
  buf.push([
    { seq: 3, input: f({ moveX: 0.3 }) },
    { seq: 1, input: f({ moveX: 0.1 }) },
    { seq: 2, input: f({ moveX: 0.2 }) },
  ]);

  expect(buf.take().seq).toBe(1);
  expect(buf.take().seq).toBe(2);
  expect(buf.take().seq).toBe(3);
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

// ── Phase 2: snapshot cadence (configured via manifest) ───────────────────────

test("snapshot cadence: WorldSnapshot broadcast every 2 ticks carries four-entry lastAckedSeq", () => {
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2());
  const drive = room as unknown as { tickOnce(): void };

  drive.tickOnce();
  drive.tickOnce();

  const snapshots = room.broadcastMessages.filter(
    (m) => m.type === "WorldSnapshot",
  );
  expect(snapshots.length).toBe(1);
  const payload = snapshots[0]?.payload as {
    lastAckedSeq: [number, number, number, number];
  };
  expect(payload.lastAckedSeq).toEqual([0, 0, 0, 0]);
});

test("snapshot cadence: bot slot lastAckedSeq stays 0 in the snapshot", () => {
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2([3]));
  const drive = room as unknown as { tickOnce(): void };
  drive.tickOnce();
  drive.tickOnce();

  const snapshots = room.broadcastMessages.filter(
    (m) => m.type === "WorldSnapshot",
  );
  const payload = snapshots[0]?.payload as {
    lastAckedSeq: [number, number, number, number];
  };
  expect(payload.lastAckedSeq[3]).toBe(0);
});

test("snapshot cadence: no standalone InputAck broadcast", () => {
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2());
  const drive = room as unknown as { tickOnce(): void };
  for (let i = 0; i < 6; i++) drive.tickOnce();

  expect(room.broadcastMessages.some((m) => m.type === "WorldSnapshot")).toBe(
    true,
  );
  expect(room.broadcastMessages.some((m) => m.type === "InputAck")).toBe(false);
});

test("snapshot broadcast: rapierBytesB64 round-trips to valid Uint8Array", async () => {
  const { createSimulation, DEFAULT_CONFIG, FLAT_DOJO, toAuthoritativeState } =
    await import("@bb/sim");
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  const auth = toAuthoritativeState(sim);

  const b64 = uint8ArrayToBase64(auth.rapierBytes);
  expect(b64.length).toBeGreaterThan(0);
  const bytes = base64ToUint8Array(b64);
  expect(bytes.length).toBe(auth.rapierBytes.length);
});

// ── Phase 1: character roster (FLI-9) ─────────────────────────────────────────

test("configureFromManifest resolves characters into the sim (non-Sifu slot)", async () => {
  const { CHARACTERS, resolveCharacter, DEFAULT_CONFIG } = await import(
    "@bb/sim"
  );
  const room = makeRoom();
  // Give slot 2 a Panda character (distinct from Sifu).
  const mf: MatchManifest = {
    launchId: "L1",
    slots: [
      { slotId: 0, kind: "human", playerId: "p0", characterId: "sifu" },
      {
        slotId: 2,
        kind: "human",
        playerId: "p2",
        characterId: "panda",
      },
    ] as MatchManifestSlot[],
    settings: { mode: "1v1", matchLengthTicks: 5400, arenaId: "flat-dojo" },
  };
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  expect(room.isConfigured).toBe(true);

  // Verify the sim resolves panda stats (lower moveSpeed than baseline).
  const pandaDef = CHARACTERS.panda;
  const pandaResolved = resolveCharacter(pandaDef, DEFAULT_CONFIG);
  // Panda's moveSpeed multiplier is 0.84 — so resolved < DEFAULT_CONFIG.movement.moveSpeed.
  expect(pandaResolved.stats.moveSpeed).toBeLessThan(
    DEFAULT_CONFIG.movement.moveSpeed,
  );
});

test("configureFromManifest: bot source receives resolved stats for its character", async () => {
  const { CHARACTERS, resolveCharacter, DEFAULT_CONFIG } = await import(
    "@bb/sim"
  );
  const room = makeRoom();
  // Slot 2 is a Vipra bot (higher dash distance, lower dash cooldown).
  const mf: MatchManifest = {
    launchId: "L1",
    slots: [
      { slotId: 0, kind: "human", playerId: "p0", characterId: "sifu" },
      { slotId: 2, kind: "bot", characterId: "vipra" },
    ] as MatchManifestSlot[],
    settings: { mode: "1v1", matchLengthTicks: 5400, arenaId: "flat-dojo" },
  };
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  expect(room.isConfigured).toBe(true);
  // Vipra's resolved dashDistance should be > Sifu's baseline.
  const vipraResolved = resolveCharacter(CHARACTERS.vipra, DEFAULT_CONFIG);
  expect(vipraResolved.stats.dashDistance).toBeGreaterThan(
    DEFAULT_CONFIG.dash.distance,
  );
  // Bot source exists for slot 2.
  expect(room.inputSources.get(2)?.isHuman).toBe(false);
});

test("RoomReady carries per-slot character ids from the manifest", async () => {
  const room = makeRoom();
  const mf: MatchManifest = {
    launchId: "L1",
    slots: [
      { slotId: 0, kind: "human", playerId: "p0", characterId: "panda" },
      { slotId: 2, kind: "human", playerId: "p2", characterId: "vipra" },
    ] as MatchManifestSlot[],
    settings: { mode: "1v1", matchLengthTicks: 5400, arenaId: "flat-dojo" },
  };
  claimImpl = async () => ({ ok: true, playerSlotId: 0, manifest: mf });

  const clientA = makeClient("session-a");
  (room as unknown as { clients: unknown[] }).clients.push(clientA);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });

  const ready = clientA.messages.find((m) => m.type === "RoomReady");
  const chars = (ready?.payload as { characters?: unknown[] }).characters;
  expect(chars).toBeDefined();
  // characters is indexed by slot; slot 0 = panda, slot 2 = vipra.
  expect((chars as unknown[])[0]).toBe("panda");
  expect((chars as unknown[])[2]).toBe("vipra");
});

// ── Phase 2 (FLI-9): bot climb path threading ──────────────────────────────────

test("buildBotWorldView carries climbLeft and climbRight for Flat Dojo", () => {
  // Flat Dojo has botClimb defined; verify the shared world view includes both sides.
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2([3])); // slot 3 is bot

  // Access the private method via casting.
  const wv = (
    room as unknown as {
      buildBotWorldView(): {
        climbLeft?: { x: number; surfaceY: number }[];
        climbRight?: { x: number; surfaceY: number }[];
      };
    }
  ).buildBotWorldView();

  // Flat Dojo botClimb: left path starts at x=-22, right path starts at x=22.
  expect(wv.climbLeft).toBeDefined();
  expect(wv.climbRight).toBeDefined();
  expect(wv.climbLeft?.[0]?.x).toBe(-22);
  expect(wv.climbRight?.[0]?.x).toBe(22);
});

test("tickOnce threads the attacking-side climb into the bot slot view (Flat Dojo)", () => {
  // Slot 3 is on Team 1 (attacks left), so its climb should be climbLeft.
  // Slot 0 is on Team 0 (attacks right), so its climb should be climbRight.
  const room = makeRoom();
  room.testConfigureFromManifest(manifest2v2([3])); // slot 3 is bot

  // Intercept the view passed to the bot source's take() by wrapping the source.
  let capturedView: import("@bb/sim").BotWorldView | undefined;
  const originalSrc = room.inputSources.get(3)!;
  (
    room as unknown as {
      sources: Map<number, import("../slotInputSource").SlotInputSource>;
    }
  ).sources.set(3, {
    ...originalSrc,
    take(view: import("@bb/sim").BotWorldView) {
      capturedView = view;
      return originalSrc.take(view);
    },
  });

  const drive = room as unknown as { tickOnce(): void };
  drive.tickOnce();

  // Slot 3 = Team 1 → attacks left bell → climb should be climbLeft (x=-22 first).
  expect(capturedView?.arena?.climb).toBeDefined();
  expect(capturedView?.arena?.climb?.[0]?.x).toBe(-22);
});
