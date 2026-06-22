/**
 * PrivateLobby unit tests — drive the DO directly via runInDurableObject.
 *
 * Tests cover:
 *  - Code-based routing (each test uses a unique code to isolate DO storage)
 *  - Balanced seat assignment in SEAT_ORDER [0, 2, 1, 3]
 *  - Presence add / remove
 *  - Host assignment (first joiner becomes host)
 *
 * Each test uses a unique lobby code to satisfy the per-file storage
 * isolation constraint (avoids bleed between tests in the same file when
 * using SQLite-backed DO storage).
 *
 * IMPORTANT: `cloudflare:test` imports are only valid inside the workerd
 * runtime — this file is excluded from the standard (non-pool) vitest run
 * and only runs via `pnpm test` (the pool workers config).
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import type { Connection } from "partyserver";
import { afterEach, expect, test } from "vitest";
import type { PrivateLobby } from "../PrivateLobby";

// Counter for unique lobby codes within this test file.
let codeSeq = 0;
function uniqueCode(): string {
  return `UNIT${String(++codeSeq).padStart(4, "0")}`;
}

type LobbyEnv = { PrivateLobby: DurableObjectNamespace<PrivateLobby> };

function getStub(code: string): DurableObjectStub<PrivateLobby> {
  const ns = (env as unknown as LobbyEnv).PrivateLobby;
  return ns.get(ns.idFromName(code));
}

afterEach(async () => {
  // No-op — unique codes per test provide isolation.
});

// ── Host assignment ───────────────────────────────────────────────────────────

test("first joiner becomes host", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const mockConn = makeMockConnection("conn-1");
    instance.onMessage(
      mockConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-alice",
        displayName: "Alice",
      }),
    );

    expect(instance.currentHostPlayerId).toBe("player-alice");
  });
});

test("second joiner does NOT become host", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connA = makeMockConnection("conn-1");
    const connB = makeMockConnection("conn-2");

    instance.onMessage(
      connA,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-alice",
        displayName: "Alice",
      }),
    );
    instance.onMessage(
      connB,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-bob",
        displayName: "Bob",
      }),
    );

    expect(instance.currentHostPlayerId).toBe("player-alice");
  });
});

// ── Balanced seat assignment [0, 2, 1, 3] ────────────────────────────────────

test("first joiner gets slot 0 (Host, Team 0)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const conn = makeMockConnection("conn-1");
    instance.onMessage(
      conn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );

    expect(instance.slotForPlayer("player-a")).toBe(0);
  });
});

test("second joiner gets slot 2 (Team 1)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connA = makeMockConnection("conn-1");
    const connB = makeMockConnection("conn-2");

    instance.onMessage(
      connA,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );
    instance.onMessage(
      connB,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-b",
        displayName: "B",
      }),
    );

    expect(instance.slotForPlayer("player-a")).toBe(0);
    expect(instance.slotForPlayer("player-b")).toBe(2);
  });
});

test("third joiner gets slot 1 (Team 0)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    for (const [i, id] of ["a", "b", "c"].entries()) {
      instance.onMessage(
        makeMockConnection(`conn-${i}`),
        JSON.stringify({
          type: "LobbyJoin",
          playerId: `player-${id}`,
          displayName: id.toUpperCase(),
        }),
      );
    }

    expect(instance.slotForPlayer("player-a")).toBe(0);
    expect(instance.slotForPlayer("player-b")).toBe(2);
    expect(instance.slotForPlayer("player-c")).toBe(1);
  });
});

test("fourth joiner gets slot 3 (Team 1)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      instance.onMessage(
        makeMockConnection(`conn-${i}`),
        JSON.stringify({
          type: "LobbyJoin",
          playerId: `player-${id}`,
          displayName: id.toUpperCase(),
        }),
      );
    }

    expect(instance.slotForPlayer("player-d")).toBe(3);
    expect(instance.seatCount).toBe(4);
  });
});

// ── Presence tracking ─────────────────────────────────────────────────────────

test("seat is present=true (connId set) when connection is open", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const conn = makeMockConnection("conn-1");
    instance.onMessage(
      conn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );

    const seat = instance.seatFor(0);
    expect(seat?.connId).toBe("conn-1");
  });
});

test("seat connId becomes null on close (presence=false)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const conn = makeMockConnection("conn-1");
    instance.onMessage(
      conn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );

    // Player disconnects.
    instance.onClose(conn);

    const seat = instance.seatFor(0);
    expect(seat?.connId).toBeNull();
    // Seat is still reserved.
    expect(seat?.playerId).toBe("player-a");
  });
});

test("seat count stays the same after player disconnects (seat is reserved)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const conn = makeMockConnection("conn-1");
    instance.onMessage(
      conn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );

    expect(instance.seatCount).toBe(1);
    instance.onClose(conn);
    // Seat is reserved — still counted.
    expect(instance.seatCount).toBe(1);
  });
});

test("reconnect with same playerId reclaims the same slot", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const conn1 = makeMockConnection("conn-1");
    instance.onMessage(
      conn1,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );
    instance.onClose(conn1);

    // Reconnect with a new connection id but same playerId.
    const conn2 = makeMockConnection("conn-2");
    instance.onMessage(
      conn2,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "player-a",
        displayName: "A",
      }),
    );

    expect(instance.slotForPlayer("player-a")).toBe(0);
    expect(instance.seatFor(0)?.connId).toBe("conn-2");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal mock Connection object for unit testing.
 * Cast to Connection to satisfy the type checker — the DO methods only
 * use `connection.id`, `connection.close()`, and `connection.send()`.
 */
function makeMockConnection(id: string): Connection {
  return {
    id,
    send: (_msg: string) => {
      /* no-op in unit tests */
    },
    close: (_code?: number, _reason?: string) => {
      /* no-op */
    },
    readyState: 1, // OPEN
    // The remaining WebSocket methods are not called by PrivateLobby.
  } as unknown as Connection;
}
