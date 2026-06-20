import { expect, test } from "vitest";
import {
  deserializeRoomReady,
  type RoomReady,
  serializeRoomReady,
} from "../index";

test("RoomReady round-trips (slot 0, not full)", () => {
  const m: RoomReady = { type: "RoomReady", slot: 0, full: false };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

test("RoomReady round-trips (slot 1, full)", () => {
  const m: RoomReady = { type: "RoomReady", slot: 1, full: true };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});
