/**
 * PrivateLobby integration tests — in-process WebSocket clients via workerd.
 *
 * Requires --max-workers=1 --no-isolate (WebSocket-in-DO constraint).
 * Run with: pnpm --filter @bb/worker test:integration
 *
 * Each test uses a unique lobby code for per-test storage isolation.
 * The worker is addressed via worker.fetch() which routes to
 * /parties/private-lobby/:code via routePartykitRequest.
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {
  createExecutionContext,
  env,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import type { LobbyState } from "@bb/protocol";
import { afterEach, expect, test } from "vitest";
import worker from "../index";
import type { PrivateLobby } from "../PrivateLobby";

let codeSeq = 0;
function uniqueCode(): string {
  return `INT${String(++codeSeq).padStart(4, "0")}`;
}

type LobbyEnv = {
  PrivateLobby: DurableObjectNamespace<PrivateLobby>;
  MATCH_LAUNCH: DurableObjectNamespace;
};

/**
 * Resolve the same PrivateLobby DO instance that the WebSocket clients are
 * connected to. routePartykitRequest addresses the DO by `idFromName(code)`,
 * so a stub obtained the same way targets that exact instance — letting us
 * inspect its post-race internal state via runInDurableObject.
 */
function lobbyStub(code: string): DurableObjectStub<PrivateLobby> {
  const ns = (env as unknown as LobbyEnv).PrivateLobby;
  return ns.get(ns.idFromName(code));
}

/** Collect the parsed message `type`s a client has received so far. */
function messageTypes(messages: string[]): string[] {
  return messages.map((m) => (JSON.parse(m) as { type?: string }).type ?? "");
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

afterEach(async () => {
  // No-op — unique codes per test provide isolation.
});

function makeCtx(): ExecutionContext {
  return createExecutionContext();
}

async function connectToLobby(
  code: string,
  ctx: ExecutionContext,
): Promise<{ ws: WebSocket; messages: string[] }> {
  const messages: string[] = [];

  const res = await worker.fetch(
    new Request(`http://x/parties/private-lobby/${code}`, {
      headers: { Upgrade: "websocket" },
    }),
    env as unknown as LobbyEnv,
    ctx,
  );

  expect(res.status).toBe(101);
  if (!res.webSocket) throw new Error("Expected WebSocket upgrade");
  const ws = res.webSocket;
  ws.accept();

  ws.addEventListener("message", (evt: MessageEvent) => {
    messages.push(evt.data as string);
  });

  return { ws, messages };
}

function parseLobbyState(raw: string): LobbyState {
  return JSON.parse(raw) as LobbyState;
}

// ── Basic connection ──────────────────────────────────────────────────────────

test("WebSocket upgrade returns 101", async () => {
  const code = uniqueCode();
  const ctx = makeCtx();

  const res = await worker.fetch(
    new Request(`http://x/parties/private-lobby/${code}`, {
      headers: { Upgrade: "websocket" },
    }),
    env as unknown as LobbyEnv,
    ctx,
  );

  expect(res.status).toBe(101);
  if (!res.webSocket) throw new Error("Expected WebSocket upgrade");
  const ws = res.webSocket;
  ws.accept();
  ws.close();

  await waitOnExecutionContext(ctx);
});

// ── Single client join ────────────────────────────────────────────────────────

test("client joins and receives LobbyState with their seat", async () => {
  const code = uniqueCode();
  const ctx = makeCtx();

  const { ws, messages } = await connectToLobby(code, ctx);

  ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "player-alice",
      displayName: "Alice",
    }),
  );

  // Give the DO event loop a moment to process the message.
  await new Promise<void>((r) => setTimeout(r, 50));

  expect(messages.length).toBeGreaterThan(0);
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) throw new Error("Expected at least one message");
  const state = parseLobbyState(lastMsg);
  expect(state.type).toBe("LobbyState");
  expect(state.code).toBe(code);
  expect(state.hostPlayerId).toBe("player-alice");

  const slot0 = state.slots.find((s) => s.slotId === 0);
  expect(slot0?.occupant?.kind).toBe("human");
  if (slot0?.occupant?.kind === "human") {
    expect(slot0.occupant.displayName).toBe("Alice");
    expect(slot0.occupant.present).toBe(true);
  }

  ws.close();
  await waitOnExecutionContext(ctx);
});

// ── Two-client presence broadcast ────────────────────────────────────────────

test("second client joining causes both clients to receive updated LobbyState", async () => {
  const code = uniqueCode();
  const ctx = makeCtx();

  const client1 = await connectToLobby(code, ctx);
  const client2 = await connectToLobby(code, ctx);

  // Alice joins first.
  client1.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "player-alice",
      displayName: "Alice",
    }),
  );

  await new Promise<void>((r) => setTimeout(r, 50));

  const beforeCount1 = client1.messages.length;

  // Bob joins second — both clients should receive an updated state.
  client2.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "player-bob",
      displayName: "Bob",
    }),
  );

  await new Promise<void>((r) => setTimeout(r, 50));

  // Client 1 should have received the update about Bob joining.
  expect(client1.messages.length).toBeGreaterThan(beforeCount1);

  // The latest state should show Bob in slot 2 (SEAT_ORDER second position).
  const lastClient1Msg = client1.messages[client1.messages.length - 1];
  if (!lastClient1Msg) throw new Error("Expected client1 to have messages");
  const latestState = parseLobbyState(lastClient1Msg);
  const slot2 = latestState.slots.find((s) => s.slotId === 2);
  expect(slot2?.occupant?.kind).toBe("human");
  if (slot2?.occupant?.kind === "human") {
    expect(slot2.occupant.displayName).toBe("Bob");
  }

  client1.ws.close();
  client2.ws.close();
  await waitOnExecutionContext(ctx);
});

// ── Presence on disconnect ────────────────────────────────────────────────────

test("client disconnect triggers presence update (present=false) broadcast", async () => {
  const code = uniqueCode();
  const ctx = makeCtx();

  const client1 = await connectToLobby(code, ctx);
  const client2 = await connectToLobby(code, ctx);

  client1.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "player-alice",
      displayName: "Alice",
    }),
  );
  client2.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "player-bob",
      displayName: "Bob",
    }),
  );

  await new Promise<void>((r) => setTimeout(r, 80));

  // Alice disconnects.
  client1.ws.close();

  await new Promise<void>((r) => setTimeout(r, 80));

  // Bob's client should have received a state update with Alice present=false.
  const lastClient2Msg = client2.messages[client2.messages.length - 1];
  if (!lastClient2Msg) throw new Error("Expected client2 to have messages");
  const latestState = parseLobbyState(lastClient2Msg);
  const aliceSlot = latestState.slots.find(
    (s) =>
      s.occupant?.kind === "human" && s.occupant.playerId === "player-alice",
  );
  expect(aliceSlot).toBeDefined();
  if (aliceSlot?.occupant?.kind === "human") {
    expect(aliceSlot.occupant.present).toBe(false);
  }

  client2.ws.close();
  await waitOnExecutionContext(ctx);
});

// ── Finding #4: drop-during-manifest-write race (no production seam) ──────────
//
// This reproduces the finding-#4 race with REAL in-process WebSocket clients —
// no test-only hook in production code. The mechanism that makes it
// deterministic (not a wall-clock gamble):
//
//   1. The host's `start` enters lock(). The pre-await guards run SYNCHRONOUSLY
//      (every seat is still present), set `locked = true`, snapshot the present
//      humans, then reach `await getServerByName(...)` / `await stub.put(...)`.
//   2. That DO→DO RPC is a NON-storage await, so the DO input gate opens — the
//      one and only point in lock() where a queued WebSocket event can be
//      delivered.
//   3. We call guest.ws.close() in the SAME synchronous turn as start, so the
//      close frame is already queued at the lobby DO before the put RPC can
//      resolve. The single-threaded workerd runtime therefore always delivers
//      onClose() (which nulls the guest's seat connId) DURING the put await,
//      never before the synchronous pre-await guards and never after lock()
//      has already returned.
//   4. lock() resumes, its post-await re-validation sees the snapshotted guest
//      dropped, and ABORTS: reverts `locked`, recovers the absent-bookkeeping,
//      sends the host a LobbyNotice, and delivers NO MatchLaunch to anyone.
//
// Verified to land on the post-await re-validation path (not the pre-await
// guard) and to be non-flaky across many consecutive runs. Reverting the
// snapshot/re-validate logic makes this test go red — proving it exercises the
// abort path rather than the pre-await guard.

test("lock() aborts (no partial launch) when a human drops during the manifest-write await", async () => {
  const code = uniqueCode();
  const ctx = makeCtx();

  const host = await connectToLobby(code, ctx);
  const guest = await connectToLobby(code, ctx);

  host.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "host-id",
      displayName: "Host",
    }),
  );
  guest.ws.send(
    JSON.stringify({
      type: "LobbyJoin",
      playerId: "guest-id",
      displayName: "Guest",
    }),
  );
  await sleep(60);

  // Complete the 2v2 with bots in slots 1 and 3 so the only thing that can fail
  // the launch is the guest dropping mid-await.
  host.ws.send(
    JSON.stringify({ type: "LobbyCommand", cmd: "fillBot", slotId: 1 }),
  );
  host.ws.send(
    JSON.stringify({ type: "LobbyCommand", cmd: "fillBot", slotId: 3 }),
  );
  await sleep(60);

  // Drive the race: issue `start`, then — in the same synchronous turn — close
  // the guest. The close lands inside lock()'s manifest-write await window.
  host.ws.send(JSON.stringify({ type: "LobbyCommand", cmd: "start" }));
  guest.ws.close();

  await sleep(120);

  // The guest dropped mid-await and can never claim their slot, so the launch
  // must be ABORTED rather than delivered as a partial launch.
  //
  // Observable on the wire:
  //  - NOBODY receives a MatchLaunch (not the host, not the guest).
  //  - The host receives a LobbyNotice explaining why (absent-human).
  const hostGotLaunch = messageTypes(host.messages).includes("MatchLaunch");
  const guestGotLaunch = messageTypes(guest.messages).includes("MatchLaunch");
  expect(hostGotLaunch).toBe(false);
  expect(guestGotLaunch).toBe(false);

  const hostNotices = host.messages
    .map((m) => JSON.parse(m) as { type?: string; reason?: string })
    .filter((m) => m.type === "LobbyNotice")
    .map((m) => m.reason);
  expect(hostNotices).toContain("absent-human");

  // Inspect the SAME DO instance to confirm the abort fully unwound: the lobby
  // is unlocked, no launch was retained, and the dropped guest was recovered
  // into the absent-expiry bookkeeping (so the ghost seat can later expire).
  await runInDurableObject(lobbyStub(code), (instance: PrivateLobby) => {
    expect(instance.isLocked).toBe(false);
    expect(instance.lastLaunchForTest).toBeNull();
    expect(instance.seatFor(2)?.connId).toBeNull();
    expect(instance.absentPlayers.has("guest-id")).toBe(true);
  });

  host.ws.close();
  await waitOnExecutionContext(ctx);
}, 30000);
