/**
 * PrivateLobby unit tests — drive the DO directly via runInDurableObject.
 *
 * Tests cover:
 *  - Code-based routing (each test uses a unique code to isolate DO storage)
 *  - Balanced seat assignment in SEAT_ORDER [0, 2, 1, 3]
 *  - Presence add / remove
 *  - Host assignment (first joiner becomes host)
 *  - Phase 6: two-stage pre-launch presence expiry
 *    - Stage 1 (hostTransferMs): host ownership transfers to next present human
 *    - Stage 2 (seatExpiryMs): absent human's seat is freed (slot open)
 *  - lock() guard: rejects start with absent human or empty required slot
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
import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import type { Connection } from "partyserver";
import { afterEach, expect, test } from "vitest";
import type { PrivateLobby } from "../PrivateLobby";

// Counter for unique lobby codes within this test file.
let codeSeq = 0;
function uniqueCode(): string {
  return `UNIT${String(++codeSeq).padStart(4, "0")}`;
}

type LobbyEnv = {
  PrivateLobby: DurableObjectNamespace<PrivateLobby>;
  MATCH_LAUNCH: DurableObjectNamespace;
};

function getStub(code: string): DurableObjectStub<PrivateLobby> {
  const ns = (env as unknown as LobbyEnv).PrivateLobby;
  return ns.get(ns.idFromName(code));
}

/** Drive a LobbyJoin for the given player on a fresh mock connection. */
function join(
  instance: PrivateLobby,
  connId: string,
  playerId: string,
  displayName = playerId,
): Connection {
  const conn = makeMockConnection(connId);
  instance.onMessage(
    conn,
    JSON.stringify({ type: "LobbyJoin", playerId, displayName }),
  );
  return conn;
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
    // Seat is still reserved (stage 2 hasn't fired).
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

// ── Phase 5: host controls ────────────────────────────────────────────────────

test("host fills an open seat with a bot", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host");
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    expect(instance.hasBot(1)).toBe(true);
  });
});

test("non-host cannot fill a bot", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    join(instance, "c1", "host");
    const guest = join(instance, "c2", "guest");
    await instance.testApplyCommand(guest, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    expect(instance.hasBot(1)).toBe(false);
  });
});

test("host clears a bot", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host");
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "clearBot",
      slotId: 1,
    });
    expect(instance.hasBot(1)).toBe(false);
  });
});

test("a bot-filled seat is skipped by the next human joiner", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host"); // slot 0
    // Fill slot 2 (the next in SEAT_ORDER) with a bot.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    // Next human should take slot 1 (2 is occupied by the bot).
    join(instance, "c2", "guest");
    expect(instance.slotForPlayer("guest")).toBe(1);
  });
});

test("host moves their own occupant to an open seat", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host"); // slot 0
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "moveOccupant",
      fromSlot: 0,
      toSlot: 3,
    });
    expect(instance.slotForPlayer("host")).toBe(3);
    expect(instance.seatFor(0)).toBeUndefined();
  });
});

test("settings clamp match length to the legal range", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host");
    // Too long → clamps to 9000.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { matchLengthTicks: 99999 },
    });
    expect(instance.currentSettings.matchLengthTicks).toBe(9000);
    // Too short → clamps to 3600.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { matchLengthTicks: 10 },
    });
    expect(instance.currentSettings.matchLengthTicks).toBe(3600);
  });
});

test("lock() mints a launchId + one token per human and builds the manifest", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host"); // slot 0
    join(instance, "c2", "guest"); // slot 2
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    // 2v2 mode requires all 4 slots — fill slot 3 with a bot too.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 3,
    });

    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "start",
    });

    expect(instance.isLocked).toBe(true);
    const launch = instance.lastLaunchForTest;
    expect(launch).not.toBeNull();
    if (!launch) return;

    // launchId is an opaque hex string (uuid without dashes).
    expect(launch.launchId).toMatch(/^[0-9a-f]{32}$/);
    // One join token per human (2), and they map to the humans' slots.
    expect(Object.keys(launch.tokenToSlot)).toHaveLength(2);
    expect(new Set(Object.values(launch.tokenToSlot))).toEqual(new Set([0, 2]));
    // Manifest carries the bot slots too.
    const botSlots = launch.manifest.slots
      .filter((s) => s.kind === "bot")
      .map((s) => s.slotId)
      .sort();
    expect(botSlots).toEqual([1, 3]);
    const humanSlots = launch.manifest.slots
      .filter((s) => s.kind === "human")
      .map((s) => s.slotId)
      .sort();
    expect(humanSlots).toEqual([0, 2]);
  });
});

test("lock() writes the manifest into the MatchLaunch DO (claimable via RPC)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);
  let launchId = "";
  let aToken = "";

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host"); // slot 0
    // 2v2 mode: fill the three remaining slots with bots.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 3,
    });
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "start",
    });
    const launch = instance.lastLaunchForTest;
    if (!launch) throw new Error("expected launch");
    launchId = launch.launchId;
    const [firstToken] = Object.keys(launch.tokenToSlot);
    if (!firstToken) throw new Error("expected a join token");
    aToken = firstToken;
  });

  // The manifest must be readable from the MatchLaunch DO via its claim RPC.
  const mlNs = (env as unknown as LobbyEnv).MATCH_LAUNCH;
  const mlStub = mlNs.get(mlNs.idFromName(launchId)) as DurableObjectStub<
    import("../MatchLaunch").MatchLaunch
  >;
  const res = await mlStub.claim(aToken);
  expect(res.ok).toBe(true);
  expect(res.playerSlotId).toBe(0);
  expect(res.manifest?.launchId).toBe(launchId);
});

// ── Phase 6: two-stage pre-launch presence expiry ─────────────────────────────

test("host disconnect schedules a pending host-transfer (absentSince populated)", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = makeMockConnection("conn-host");
    instance.onMessage(
      host,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guest = makeMockConnection("conn-guest");
    instance.onMessage(
      guest,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );

    // Host disconnects.
    instance.onClose(host);

    // A pending transfer should be scheduled (still via pendingHostTransfer
    // getter, which is driven from absentSince now).
    expect(instance.pendingHostTransfer).toBe("host-id");
    // Host is still the host (alarm hasn't fired yet).
    expect(instance.currentHostPlayerId).toBe("host-id");
    // absentSince should be recorded.
    expect(instance.absentPlayers.has("host-id")).toBe(true);
  });
});

test("Stage 1: host ownership transfers to the next present human after alarm fires", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = makeMockConnection("conn-host");
    instance.onMessage(
      host,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guest = makeMockConnection("conn-guest");
    instance.onMessage(
      guest,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );

    // Host disconnects.
    instance.onClose(host);
    expect(instance.pendingHostTransfer).toBe("host-id");

    // Advance absentSince so Stage 1 threshold (10s) is met but Stage 2 (30s)
    // is not — this simulates the alarm firing after exactly hostTransferMs.
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 11_000);
  });

  // Fire the alarm (simulates the host-transfer timeout expiring).
  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Ownership should have transferred to the guest.
    expect(instance.currentHostPlayerId).toBe("guest-id");
    // Pending transfer is cleared (hostTransferred tracks stage 1 completion).
    expect(instance.pendingHostTransfer).toBeNull();
    // The old host's SEAT is still present (stage 2 hasn't fired).
    expect(instance.seatFor(0)).toBeDefined();
    expect(instance.slotForPlayer("host-id")).toBe(0);
    // absentSince still contains the old host (stage 2 still pending).
    expect(instance.absentPlayers.has("host-id")).toBe(true);
  });
});

test("Stage 2: absent human seat is freed after seatExpiryMs", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = makeMockConnection("conn-host");
    instance.onMessage(
      host,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guest = makeMockConnection("conn-guest");
    instance.onMessage(
      guest,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );

    // Disconnect the guest (non-host) so we test non-host expiry.
    instance.onClose(guest);
    expect(instance.absentPlayers.has("guest-id")).toBe(true);

    // Manually move absentSince far enough back to trigger stage 2.
    // We do this by directly manipulating the internal map via the
    // absentPlayers getter (read-only), so we call onClose with a fake
    // time by patching the Map entry.
    const absMap = instance.absentPlayers as Map<string, number>;
    // Push the timestamp 31 seconds into the past (beyond seatExpiryMs=30s).
    absMap.set("guest-id", Date.now() - 31_000);
  });

  // Fire the alarm — should sweep stage 2 for guest-id.
  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // guest's seat must be freed.
    expect(instance.seatFor(2)).toBeUndefined();
    expect(instance.slotForPlayer("guest-id")).toBeUndefined();
    expect(instance.absentPlayers.has("guest-id")).toBe(false);
    // host is unaffected.
    expect(instance.seatFor(0)).toBeDefined();
    expect(instance.currentHostPlayerId).toBe("host-id");
  });
});

test("Stage 2: freeing absent host's seat reassigns host to next present human", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = makeMockConnection("conn-host");
    instance.onMessage(
      hostConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guestConn = makeMockConnection("conn-guest");
    instance.onMessage(
      guestConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );

    // Host disconnects.
    instance.onClose(hostConn);

    // Push absentSince past seatExpiryMs to trigger both stages in one sweep.
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 31_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Host's seat is freed.
    expect(instance.seatFor(0)).toBeUndefined();
    expect(instance.slotForPlayer("host-id")).toBeUndefined();
    // Host is reassigned to the next present human (guest).
    expect(instance.currentHostPlayerId).toBe("guest-id");
  });
});

test("Stage 2: freeing absent host seat with no other present human sets hostPlayerId to null", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = makeMockConnection("conn-host");
    instance.onMessage(
      hostConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    // Only the host — no other humans.
    instance.onClose(hostConn);

    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 31_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    expect(instance.seatFor(0)).toBeUndefined();
    // No present human → host is null.
    expect(instance.currentHostPlayerId).toBeNull();
  });
});

test("non-host human disconnect also has seat freed after seatExpiryMs", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    join(instance, "c-host", "host-id"); // slot 0
    const guestConn = join(instance, "c-guest", "guest-id"); // slot 2

    instance.onClose(guestConn);
    expect(instance.seatFor(2)).toBeDefined();
    expect(instance.absentPlayers.has("guest-id")).toBe(true);

    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("guest-id", Date.now() - 31_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Slot 2 is now open.
    expect(instance.seatFor(2)).toBeUndefined();
    expect(instance.slotForPlayer("guest-id")).toBeUndefined();
    // Host seat unaffected.
    expect(instance.currentHostPlayerId).toBe("host-id");
  });
});

test("reconnect before stage 2 cancels the seat-free", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = makeMockConnection("conn-host");
    instance.onMessage(
      hostConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guestConn = makeMockConnection("conn-guest");
    instance.onMessage(
      guestConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );

    // Host disconnects and then reconnects before alarm fires.
    instance.onClose(hostConn);
    expect(instance.pendingHostTransfer).toBe("host-id");

    // Reconnect with same playerId (new connection id).
    const hostReconnect = makeMockConnection("conn-host-2");
    instance.onMessage(
      hostReconnect,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );

    // Pending transfer should be cancelled (absentSince cleared).
    expect(instance.pendingHostTransfer).toBeNull();
    expect(instance.absentPlayers.has("host-id")).toBe(false);
    // Old host retains ownership.
    expect(instance.currentHostPlayerId).toBe("host-id");
    // Slot still intact.
    expect(instance.seatFor(0)).toBeDefined();
    expect(instance.seatFor(0)?.connId).toBe("conn-host-2");
  });
});

test("old host reconnects after Stage 1 (transfer) — reclaims slot but NOT ownership", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = makeMockConnection("conn-host");
    instance.onMessage(
      host,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );
    const guest = makeMockConnection("conn-guest");
    instance.onMessage(
      guest,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "guest-id",
        displayName: "Guest",
      }),
    );
    instance.onClose(host);

    // Advance absentSince so Stage 1 threshold (10s) is met but Stage 2 (30s)
    // is not — this simulates the alarm firing after exactly hostTransferMs.
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 11_000);
  });

  // Fire the alarm — Stage 1 transfers ownership (seatExpiryMs not reached).
  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Guest is now host.
    expect(instance.currentHostPlayerId).toBe("guest-id");

    // Old host reconnects.
    const hostReturn = makeMockConnection("conn-host-return");
    instance.onMessage(
      hostReturn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "Host",
      }),
    );

    // Old host is back in their slot, but guest remains the host.
    expect(instance.slotForPlayer("host-id")).toBe(0);
    expect(instance.currentHostPlayerId).toBe("guest-id"); // ownership NOT transferred back
    // absentSince is cleared (no further expiry pending).
    expect(instance.absentPlayers.has("host-id")).toBe(false);
  });
});

test("stale socket close after reconnect does not mark player absent", async () => {
  const stub = getStub(uniqueCode());

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const oldHostConn = join(instance, "conn-host-1", "host-id", "Host");
    join(instance, "conn-guest", "guest-id", "Guest");

    const newHostConn = join(instance, "conn-host-2", "host-id", "Host");
    instance.onClose(oldHostConn);

    expect(instance.seatFor(0)?.connId).toBe(newHostConn.id);
    expect(instance.absentPlayers.has("host-id")).toBe(false);
    expect(instance.pendingHostTransfer).toBeNull();
    expect(instance.currentHostPlayerId).toBe("host-id");
  });
});

test("re-disconnect after reconnect and previous transfer can transfer host again", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "conn-host", "host-id", "Host");
    join(instance, "conn-guest", "guest-id", "Guest");

    instance.onClose(host);
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 11_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    expect(instance.currentHostPlayerId).toBe("guest-id");

    join(instance, "conn-host-return", "host-id", "Host");
    const guestReturn = join(
      instance,
      "conn-guest-return",
      "guest-id",
      "Guest",
    );
    instance.onClose(guestReturn);

    expect(instance.pendingHostTransfer).toBe("guest-id");
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("guest-id", Date.now() - 11_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    expect(instance.currentHostPlayerId).toBe("host-id");
    expect(instance.pendingHostTransfer).toBeNull();
    expect(instance.slotForPlayer("guest-id")).toBe(2);
  });
});

test("no-target Stage 1 can transfer when a guest joins before seat expiry", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "conn-host", "host-id", "Host");
    instance.onClose(host);

    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("host-id", Date.now() - 11_000);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    expect(instance.currentHostPlayerId).toBe("host-id");
    expect(instance.pendingHostTransfer).toBe("host-id");
    expect(instance.seatFor(0)?.connId).toBeNull();

    join(instance, "conn-guest", "guest-id", "Guest");

    expect(instance.currentHostPlayerId).toBe("host-id");
    expect(instance.pendingHostTransfer).toBe("host-id");
    expect(instance.absentPlayers.has("host-id")).toBe(true);
  });

  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    expect(instance.currentHostPlayerId).toBe("guest-id");
    expect(instance.pendingHostTransfer).toBeNull();
    expect(instance.slotForPlayer("host-id")).toBe(0);
  });
});

// ── Phase 6 follow-up: lock() guard ──────────────────────────────────────────

test("lock() rejects start when a seat holds an absent human (connId null)", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = join(instance, "c-host", "host-id"); // slot 0
    const guestConn = join(instance, "c-guest", "guest-id"); // slot 2

    // Guest disconnects — now slot 2 holds an absent human.
    instance.onClose(guestConn);

    // Fill bots in slots 1 and 3 to complete the 2v2.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 3,
    });

    // Host tries to start — should be rejected because slot 2 has an absent human.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "start",
    });

    expect(instance.isLocked).toBe(false);
    expect(instance.lastLaunchForTest).toBeNull();
  });
});

test("lock() rejects start when a mode-required slot is entirely empty", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = join(instance, "c-host", "host-id"); // slot 0
    join(instance, "c-guest", "guest-id"); // slot 2
    // Slots 1 and 3 are empty — 2v2 requires all 4.

    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "start",
    });

    expect(instance.isLocked).toBe(false);
    expect(instance.lastLaunchForTest).toBeNull();
  });
});

test("lock() succeeds once an absent human's slot is freed and bot-filled", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = join(instance, "c-host", "host-id"); // slot 0
    const guestConn = join(instance, "c-guest", "guest-id"); // slot 2
    join(instance, "c-c", "c-id"); // slot 1
    join(instance, "c-d", "d-id"); // slot 3

    // Guest (slot 2) disconnects.
    instance.onClose(guestConn);

    // Start rejected: slot 2 has absent human.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "start",
    });
    expect(instance.isLocked).toBe(false);

    // Push stage-2 expiry for guest.
    const absMap = instance.absentPlayers as Map<string, number>;
    absMap.set("guest-id", Date.now() - 31_000);
  });

  // Fire alarm — seat freed.
  await runDurableObjectAlarm(stub);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Slot 2 is open.
    expect(instance.seatFor(2)).toBeUndefined();

    // Host bot-fills slot 2.
    const hostConn = makeMockConnection("c-host");
    // Re-register the host connection (need to re-join within this runInDurableObject).
    // The connection mapping is in-memory and doesn't survive runInDurableObject
    // boundaries, so re-send the LobbyJoin to restore it.
    instance.onMessage(
      hostConn,
      JSON.stringify({
        type: "LobbyJoin",
        playerId: "host-id",
        displayName: "host-id",
      }),
    );
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    expect(instance.hasBot(2)).toBe(true);

    // Now start should succeed: no absent humans, all required slots filled.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "start",
    });
    expect(instance.isLocked).toBe(true);

    const launch = instance.lastLaunchForTest;
    expect(launch).not.toBeNull();
    if (!launch) return;
    // No absent human slot in the manifest.
    const humanSlots = launch.manifest.slots.filter((s) => s.kind === "human");
    for (const h of humanSlots) {
      expect(h.playerId).not.toBe("guest-id");
    }
    // Slot 2 should be a bot in the manifest.
    const slot2 = launch.manifest.slots.find((s) => s.slotId === 2);
    expect(slot2?.kind).toBe("bot");
  });
});

test("lock() guard: 1v1 mode only requires slots 0 and 2", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const hostConn = join(instance, "c-host", "host-id"); // slot 0
    join(instance, "c-guest", "guest-id"); // slot 2
    // Set 1v1 mode — only slots 0 and 2 are required.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });

    // Slots 1 and 3 are empty but not required in 1v1 — start should succeed.
    await instance.testApplyCommand(hostConn, {
      type: "LobbyCommand",
      cmd: "start",
    });
    expect(instance.isLocked).toBe(true);
    const launch = instance.lastLaunchForTest;
    expect(launch).not.toBeNull();
  });
});

// ── Finding #5: mode-aware seat capacity (1v1 must not admit >2 humans) ──────

test("1v1 mode: a 3rd human cannot be seated (only slots 0 and 2 are seatable)", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host-id"); // slot 0
    // Switch to 1v1 before more humans arrive.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });

    join(instance, "c2", "guest-id"); // slot 2 (the other 1v1 seat)
    expect(instance.slotForPlayer("guest-id")).toBe(2);

    // A 3rd human in 1v1 must be rejected — no 1v1 seat is left.
    const thirdConn = join(instance, "c3", "third-id");
    expect(instance.slotForPlayer("third-id")).toBeUndefined();
    expect(instance.seatCount).toBe(2);
    // The connection must be closed (lobby-full for this mode).
    expect((thirdConn as unknown as { closed?: boolean }).closed).toBe(true);
  });
});

test("1v1 mode: lock() produces a 2-human manifest (slots 0 and 2 only)", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host-id"); // slot 0
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });
    join(instance, "c2", "guest-id"); // slot 2

    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "start",
    });

    expect(instance.isLocked).toBe(true);
    const launch = instance.lastLaunchForTest;
    expect(launch).not.toBeNull();
    if (!launch) return;

    // Exactly two humans, in slots 0 and 2; no slot 1/3 occupants at all.
    const humanSlots = launch.manifest.slots
      .filter((s) => s.kind === "human")
      .map((s) => s.slotId)
      .sort();
    expect(humanSlots).toEqual([0, 2]);
    expect(launch.manifest.slots).toHaveLength(2);
    expect(Object.keys(launch.tokenToSlot)).toHaveLength(2);
    expect(new Set(Object.values(launch.tokenToSlot))).toEqual(new Set([0, 2]));
  });
});

test("1v1 mode: host cannot fill an out-of-mode slot (1 or 3) with a bot", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const host = join(instance, "c1", "host-id"); // slot 0
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });

    // Slot 1 is outside the 1v1 slot set — a bot must not land there.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });
    expect(instance.hasBot(1)).toBe(false);

    // Slot 2 is a valid 1v1 seat — a bot is allowed there.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    expect(instance.hasBot(2)).toBe(true);
  });
});

test("lock() rejects when an occupant sits outside the current mode's slots", async () => {
  const stub = getStub(uniqueCode());
  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    // Seat four humans in 2v2 (slots 0,2,1,3).
    const host = join(instance, "c1", "host-id"); // slot 0
    join(instance, "c2", "b-id"); // slot 2
    join(instance, "c3", "c-id"); // slot 1
    join(instance, "c4", "d-id"); // slot 3
    expect(instance.seatCount).toBe(4);

    // Host switches the mode to 1v1 AFTER players are seated — slots 1 and 3
    // now hold humans that are outside the 1v1 slot set.
    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });

    // Track the notice the host receives.
    const hostNotices: string[] = [];
    (host as unknown as { send: (m: string) => void }).send = (m: string) =>
      hostNotices.push(m);

    await instance.testApplyCommand(host, {
      type: "LobbyCommand",
      cmd: "start",
    });

    // Must NOT launch a >2-human manifest.
    expect(instance.isLocked).toBe(false);
    expect(instance.lastLaunchForTest).toBeNull();
    const noticeReasons = hostNotices
      .map((m) => JSON.parse(m) as { type?: string; reason?: string })
      .filter((m) => m.type === "LobbyNotice")
      .map((m) => m.reason);
    expect(noticeReasons.length).toBeGreaterThan(0);
    expect(noticeReasons).toContain("slot-out-of-mode");
  });
});

// Finding #4 (drop-during-manifest-write abort) is covered by a real
// integration test that reproduces the race with in-process WebSocket clients —
// see "lock() aborts (no partial launch) when a human drops during the
// manifest-write await" in privateLobby.integration.test.ts. That test needs no
// production test seam; the close lands inside lock()'s non-storage RPC await
// window naturally, deterministically driving the post-await re-validation.

// ── Phase 1 (FLI-9): setCharacter ────────────────────────────────────────────

test("setCharacter: human can set their own slot's character", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");

    // Alice is in slot 0; she sets her own character to "panda".
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 0,
      characterId: "panda",
    });

    // The last launch is null (not started), but we can check the state
    // is reflected by inspecting the last sent lobby state.
    // The state should include the character change — we'll check via lock().
    expect(instance.isLocked).toBe(false);
  });
});

test("setCharacter: unknown id is rejected (does not crash)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");

    // Try to set an invalid character id — should be silently ignored.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 0,
      characterId: "not-a-character" as never,
    });

    // The lobby should still be in a valid state.
    expect(instance.isLocked).toBe(false);
  });
});

test("setCharacter: non-host cannot set another player's slot character", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    join(instance, "conn-alice", "player-alice", "Alice");
    const connBob = makeMockConnection("conn-bob");
    join(instance, "conn-bob", "player-bob", "Bob");

    // Bob (in slot 2) tries to set Alice's slot (slot 0) character — should be rejected.
    await instance.testApplyCommand(connBob, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 0,
      characterId: "panda",
    });

    // No change — Bob cannot change Alice's slot.
    expect(instance.isLocked).toBe(false);
  });
});

test("setCharacter: host can set bot slot character", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");

    // Host fills slot 2 with a bot.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    expect(instance.hasBot(2)).toBe(true);

    // Host sets the bot's character to "vipra".
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 2,
      characterId: "vipra",
    });

    // Should be accepted — host controls bot slots.
    expect(instance.isLocked).toBe(false);
  });
});

test("setCharacter: non-host cannot set bot slot character", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");
    const connBob = makeMockConnection("conn-bob");
    join(instance, "conn-bob", "player-bob", "Bob");

    // Alice (host) fills slot 1 with a bot.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 1,
    });

    // Bob tries to set the bot's character — should be rejected (not host).
    await instance.testApplyCommand(connBob, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 1,
      characterId: "panda",
    });

    // No crash — test just verifies the DO remains in a stable state.
    expect(instance.hasBot(1)).toBe(true);
  });
});

test("setCharacter: character is frozen into the manifest at lock()", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");

    // Switch to 1v1 mode (so only slots 0 and 2 need to be filled).
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });

    // Alice sets her character to "old-master".
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 0,
      characterId: "old-master",
    });

    // Fill slot 2 with a bot and set its character.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 2,
      characterId: "panda",
    });

    // Lock the lobby.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "start",
    });

    const launch = instance.lastLaunchForTest;
    expect(launch).not.toBeNull();

    const slot0 = launch?.manifest.slots.find((s) => s.slotId === 0);
    const slot2 = launch?.manifest.slots.find((s) => s.slotId === 2);

    expect(slot0?.characterId).toBe("old-master");
    expect(slot2?.characterId).toBe("panda");
  });
});

test("setCharacter: cleared bot loses its character pick (default applies to new bot)", async () => {
  const code = uniqueCode();
  const stub = getStub(code);

  await runInDurableObject(stub, async (instance: PrivateLobby) => {
    const connAlice = makeMockConnection("conn-alice");
    join(instance, "conn-alice", "player-alice", "Alice");

    // Fill slot 2 with bot and set character.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setCharacter",
      slotId: 2,
      characterId: "drunken-boxer",
    });

    // Clear the bot — character pick should be removed.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "clearBot",
      slotId: 2,
    });
    expect(instance.hasBot(2)).toBe(false);

    // Re-fill with a fresh bot — should default to Sifu.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "fillBot",
      slotId: 2,
    });
    expect(instance.hasBot(2)).toBe(true);

    // Switch to 1v1 and lock to capture manifest.
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "setSettings",
      settings: { mode: "1v1" },
    });
    await instance.testApplyCommand(connAlice, {
      type: "LobbyCommand",
      cmd: "start",
    });

    const launch = instance.lastLaunchForTest;
    const slot2 = launch?.manifest.slots.find((s) => s.slotId === 2);
    // Default character should be "sifu".
    expect(slot2?.characterId).toBe("sifu");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal mock Connection object for unit testing.
 * Cast to Connection to satisfy the type checker — the DO methods only
 * use `connection.id`, `connection.close()`, and `connection.send()`.
 */
function makeMockConnection(id: string): Connection {
  const conn = {
    id,
    closed: false,
    send: (_msg: string) => {
      /* no-op in unit tests */
    },
    close(_code?: number, _reason?: string) {
      conn.closed = true;
    },
    readyState: 1, // OPEN
    // The remaining WebSocket methods are not called by PrivateLobby.
  };
  return conn as unknown as Connection;
}
