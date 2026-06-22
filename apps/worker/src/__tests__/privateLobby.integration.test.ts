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
  waitOnExecutionContext,
} from "cloudflare:test";
import type { LobbyState } from "@bb/protocol";
import { afterEach, expect, test } from "vitest";
import worker from "../index";

let codeSeq = 0;
function uniqueCode(): string {
  return `INT${String(++codeSeq).padStart(4, "0")}`;
}

type LobbyEnv = {
  PrivateLobby: DurableObjectNamespace;
  MATCH_LAUNCH: DurableObjectNamespace;
};

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
  const ws = res.webSocket!;
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
  const ws = res.webSocket!;
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
  const state = parseLobbyState(messages[messages.length - 1]!);
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
  const latestState = parseLobbyState(
    client1.messages[client1.messages.length - 1]!,
  );
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
  const latestState = parseLobbyState(
    client2.messages[client2.messages.length - 1]!,
  );
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
