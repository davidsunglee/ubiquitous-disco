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
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
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
        ? { slotId: s, kind: "bot" }
        : { slotId: s, kind: "human", playerId: `p${s}` },
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

// ── Phase 5: fail-closed disconnect (unchanged from Plan 1) ───────────────────

test("onLeave broadcasts MatchClosed(peer-left) and disposes", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = { t0: 0, t1: 1 };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token],
    manifest: mf,
  });

  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);

  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clientB as never, { launchId: "L1", joinToken: "t1" });

  expect(room.disconnectCalled).toBe(false);
  room.onLeave(clientA as never);

  const closed = room.broadcastMessages.find((m) => m.type === "MatchClosed");
  expect((closed?.payload as { reason: string }).reason).toBe("peer-left");
  expect(clientB.messages.some((m) => m.type === "MatchClosed")).toBe(true);
  expect(room.disconnectCalled).toBe(true);
  expect(room.isDisposed).toBe(true);
});

test("onLeave: double-leave does not double-broadcast", async () => {
  const room = makeRoom();
  const mf = manifest2v2();
  const tokenSlot: Record<string, PlayerSlotId> = { t0: 0, t1: 1 };
  claimImpl = async (_l, token) => ({
    ok: true,
    playerSlotId: tokenSlot[token],
    manifest: mf,
  });

  const clientA = makeClient("session-a");
  const clientB = makeClient("session-b");
  (room as unknown as { clients: unknown[] }).clients.push(clientA, clientB);
  await room.onJoin(clientA as never, { launchId: "L1", joinToken: "t0" });
  await room.onJoin(clientB as never, { launchId: "L1", joinToken: "t1" });

  room.onLeave(clientA as never);
  room.onLeave(clientB as never);

  const closedCount = room.broadcastMessages.filter(
    (m) => m.type === "MatchClosed",
  ).length;
  expect(closedCount).toBe(1);
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
