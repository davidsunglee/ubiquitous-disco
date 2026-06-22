/**
 * Protocol lobby round-trip tests.
 *
 * Verifies that LobbyJoin and LobbyState serialize and deserialize correctly.
 */

import { expect, test } from "vitest";
import {
  deserializeLobbyJoin,
  deserializeLobbyState,
  type LobbyJoin,
  type LobbySlot,
  type LobbyState,
  serializeLobbyJoin,
  serializeLobbyState,
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
