/**
 * Protocol lobby round-trip tests.
 *
 * Verifies that LobbyJoin and LobbyState serialize and deserialize correctly.
 */

import { expect, test } from "vitest";
import {
  deserializeLobbyCommand,
  deserializeLobbyJoin,
  deserializeLobbyNotice,
  deserializeLobbyState,
  deserializeMatchClosed,
  deserializeMatchLaunch,
  deserializeReconnectClaim,
  type LobbyCommand,
  type LobbyJoin,
  type LobbyNotice,
  type LobbySlot,
  type LobbyState,
  type MatchClosed,
  type MatchLaunch,
  type ReconnectClaim,
  serializeLobbyCommand,
  serializeLobbyJoin,
  serializeLobbyNotice,
  serializeLobbyState,
  serializeMatchClosed,
  serializeMatchLaunch,
  serializeReconnectClaim,
} from "../index";

// ── LobbyJoin ─────────────────────────────────────────────────────────────────

test("LobbyJoin round-trips", () => {
  const m: LobbyJoin = {
    type: "LobbyJoin",
    playerId: "player-uuid-123",
    displayName: "Alice",
  };
  expect(deserializeLobbyJoin(serializeLobbyJoin(m))).toEqual(m);
});

test("LobbyJoin preserves displayName after round-trip", () => {
  const m: LobbyJoin = {
    type: "LobbyJoin",
    playerId: "abc",
    displayName: "Bob 🎮",
  };
  const decoded = deserializeLobbyJoin(serializeLobbyJoin(m));
  expect(decoded.displayName).toBe("Bob 🎮");
  expect(decoded.type).toBe("LobbyJoin");
});

// ── LobbyState ────────────────────────────────────────────────────────────────

function makeLobbyState(): LobbyState {
  const slots: LobbySlot[] = [
    {
      slotId: 0,
      occupant: {
        kind: "human",
        playerId: "player-uuid-123",
        displayName: "Alice",
        present: true,
      },
    },
    { slotId: 1, occupant: null },
    {
      slotId: 2,
      occupant: {
        kind: "human",
        playerId: "player-uuid-456",
        displayName: "Bob",
        present: false,
      },
    },
    { slotId: 3, occupant: { kind: "bot" } },
  ];
  return {
    type: "LobbyState",
    code: "ABC123",
    hostPlayerId: "player-uuid-123",
    slots,
    settings: {
      mode: "2v2",
      matchLengthTicks: 5400,
      arenaId: "flat-dojo",
    },
  };
}

test("LobbyState round-trips (full 2v2 with mixed occupants)", () => {
  const m = makeLobbyState();
  expect(deserializeLobbyState(serializeLobbyState(m))).toEqual(m);
});

test("LobbyState preserves code after round-trip", () => {
  const m = makeLobbyState();
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  expect(decoded.code).toBe("ABC123");
  expect(decoded.type).toBe("LobbyState");
});

test("LobbyState preserves settings after round-trip", () => {
  const m = makeLobbyState();
  m.settings.matchLengthTicks = 7200;
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  expect(decoded.settings.matchLengthTicks).toBe(7200);
  expect(decoded.settings.mode).toBe("2v2");
  expect(decoded.settings.arenaId).toBe("flat-dojo");
});

test("LobbyState preserves human occupant presence flag", () => {
  const m = makeLobbyState();
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  const slot0 = decoded.slots[0];
  expect(slot0?.occupant?.kind).toBe("human");
  if (slot0?.occupant?.kind === "human") {
    expect(slot0.occupant.present).toBe(true);
  }
  const slot2 = decoded.slots[2];
  expect(slot2?.occupant?.kind).toBe("human");
  if (slot2?.occupant?.kind === "human") {
    expect(slot2.occupant.present).toBe(false);
  }
});

test("LobbyState preserves bot occupant", () => {
  const m = makeLobbyState();
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  const slot3 = decoded.slots[3];
  expect(slot3?.occupant?.kind).toBe("bot");
});

test("LobbyState preserves null occupant (empty slot)", () => {
  const m = makeLobbyState();
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  const slot1 = decoded.slots[1];
  expect(slot1?.occupant).toBeNull();
});

test("LobbyState round-trips with 1v1 mode", () => {
  const m = makeLobbyState();
  m.settings.mode = "1v1";
  const decoded = deserializeLobbyState(serializeLobbyState(m));
  expect(decoded.settings.mode).toBe("1v1");
});

// ── LobbyCommand (Phase 5) ────────────────────────────────────────────────────

test("LobbyCommand moveOccupant round-trips", () => {
  const m: LobbyCommand = {
    type: "LobbyCommand",
    cmd: "moveOccupant",
    fromSlot: 0,
    toSlot: 1,
  };
  expect(deserializeLobbyCommand(serializeLobbyCommand(m))).toEqual(m);
});

test("LobbyCommand fillBot / clearBot round-trip", () => {
  const fill: LobbyCommand = {
    type: "LobbyCommand",
    cmd: "fillBot",
    slotId: 3,
  };
  const clear: LobbyCommand = {
    type: "LobbyCommand",
    cmd: "clearBot",
    slotId: 3,
  };
  expect(deserializeLobbyCommand(serializeLobbyCommand(fill))).toEqual(fill);
  expect(deserializeLobbyCommand(serializeLobbyCommand(clear))).toEqual(clear);
});

test("LobbyCommand setSettings round-trips a partial settings patch", () => {
  const m: LobbyCommand = {
    type: "LobbyCommand",
    cmd: "setSettings",
    settings: { matchLengthTicks: 7200 },
  };
  const decoded = deserializeLobbyCommand(serializeLobbyCommand(m));
  expect(decoded).toEqual(m);
  if (decoded.cmd === "setSettings") {
    expect(decoded.settings.matchLengthTicks).toBe(7200);
  }
});

test("LobbyCommand start round-trips", () => {
  const m: LobbyCommand = { type: "LobbyCommand", cmd: "start" };
  expect(deserializeLobbyCommand(serializeLobbyCommand(m))).toEqual(m);
});

// ── MatchLaunch (Phase 5) ─────────────────────────────────────────────────────

test("MatchLaunch round-trips", () => {
  const m: MatchLaunch = {
    type: "MatchLaunch",
    launchId: "abc123def456",
    playerSlotId: 2,
    joinToken: "tok-xyz",
  };
  expect(deserializeMatchLaunch(serializeMatchLaunch(m))).toEqual(m);
});

// ── Phase 6: ReconnectClaim + MatchClosed("reconnect-expired") ───────────────

test("ReconnectClaim round-trips", () => {
  const m: ReconnectClaim = {
    type: "ReconnectClaim",
    launchId: "launch123abc",
    joinToken: "tok-reconnect",
  };
  expect(deserializeReconnectClaim(serializeReconnectClaim(m))).toEqual(m);
});

test("ReconnectClaim preserves launchId and joinToken", () => {
  const m: ReconnectClaim = {
    type: "ReconnectClaim",
    launchId: "deadbeef1234",
    joinToken: "my-one-time-token",
  };
  const decoded = deserializeReconnectClaim(serializeReconnectClaim(m));
  expect(decoded.type).toBe("ReconnectClaim");
  expect(decoded.launchId).toBe("deadbeef1234");
  expect(decoded.joinToken).toBe("my-one-time-token");
});

test('MatchClosed("reconnect-expired") round-trips', () => {
  const m: MatchClosed = { type: "MatchClosed", reason: "reconnect-expired" };
  const decoded = deserializeMatchClosed(serializeMatchClosed(m));
  expect(decoded.type).toBe("MatchClosed");
  expect(decoded.reason).toBe("reconnect-expired");
});

test("MatchClosed reason union includes all three variants", () => {
  const reasons: MatchClosed["reason"][] = [
    "peer-left",
    "server-shutdown",
    "reconnect-expired",
  ];
  for (const reason of reasons) {
    const m: MatchClosed = { type: "MatchClosed", reason };
    expect(deserializeMatchClosed(serializeMatchClosed(m)).reason).toBe(reason);
  }
});

// ── LobbyNotice (Phase 6 follow-up: lock() guard) ───────────────────────────

test("LobbyNotice absent-human round-trips", () => {
  const m: LobbyNotice = { type: "LobbyNotice", reason: "absent-human" };
  const decoded = deserializeLobbyNotice(serializeLobbyNotice(m));
  expect(decoded.type).toBe("LobbyNotice");
  expect(decoded.reason).toBe("absent-human");
});

test("LobbyNotice empty-required-slot round-trips", () => {
  const m: LobbyNotice = {
    type: "LobbyNotice",
    reason: "empty-required-slot",
  };
  const decoded = deserializeLobbyNotice(serializeLobbyNotice(m));
  expect(decoded.type).toBe("LobbyNotice");
  expect(decoded.reason).toBe("empty-required-slot");
});

test("LobbyNotice slot-out-of-mode round-trips", () => {
  const m: LobbyNotice = {
    type: "LobbyNotice",
    reason: "slot-out-of-mode",
  };
  const decoded = deserializeLobbyNotice(serializeLobbyNotice(m));
  expect(decoded.type).toBe("LobbyNotice");
  expect(decoded.reason).toBe("slot-out-of-mode");
});

test("LobbyNotice reason union includes all variants", () => {
  const reasons: LobbyNotice["reason"][] = [
    "absent-human",
    "empty-required-slot",
    "slot-out-of-mode",
  ];
  for (const reason of reasons) {
    const m: LobbyNotice = { type: "LobbyNotice", reason };
    expect(deserializeLobbyNotice(serializeLobbyNotice(m)).reason).toBe(reason);
  }
});
