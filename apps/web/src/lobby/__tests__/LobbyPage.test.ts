import type {
  CharacterId,
  LobbySlot,
  LobbyState,
  PlayerSlotId,
} from "@bb/protocol";
import { describe, expect, test } from "vitest";
import { isLobbyStartable } from "../LobbyPage";

const BOT = { kind: "bot", characterId: "sifu" as CharacterId } as const;

function makeState(
  mode: "1v1" | "2v2",
  occupiedSlots: PlayerSlotId[],
): LobbyState {
  const slots: LobbySlot[] = ([0, 1, 2, 3] as PlayerSlotId[]).map((slotId) => ({
    slotId,
    occupant: occupiedSlots.includes(slotId) ? BOT : null,
  }));

  return {
    type: "LobbyState",
    code: "ABCD12",
    hostPlayerId: "host",
    slots,
    settings: {
      mode,
      matchLengthTicks: 5400,
      arenaId: "flat-dojo",
    },
  };
}

describe("isLobbyStartable", () => {
  test("allows 1v1 when only required slots are occupied", () => {
    expect(isLobbyStartable(makeState("1v1", [0, 2]))).toBe(true);
  });

  test("rejects occupied slots outside the selected mode", () => {
    expect(isLobbyStartable(makeState("1v1", [0, 1, 2, 3]))).toBe(false);
  });

  test("still requires every selected-mode slot to be occupied", () => {
    expect(isLobbyStartable(makeState("2v2", [0, 1, 2]))).toBe(false);
  });
});
