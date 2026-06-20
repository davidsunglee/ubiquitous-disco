import { EMPTY_INPUT } from "@bb/sim";
import { expect, test } from "vitest";
import {
  deserializeInputAck,
  deserializeMatchClosed,
  deserializePlayerInput,
  deserializeRoomReady,
  deserializeTelemetry,
  deserializeWorldSnapshot,
  type InputAck,
  type MatchClosed,
  type PlayerInput,
  type RoomReady,
  serializeInputAck,
  serializeMatchClosed,
  serializePlayerInput,
  serializeRoomReady,
  serializeTelemetry,
  serializeWorldSnapshot,
  type Telemetry,
  type WorldSnapshot,
} from "../index";

// ── RoomReady ─────────────────────────────────────────────────────────────────

test("RoomReady round-trips (slot 0, not full)", () => {
  const m: RoomReady = { type: "RoomReady", slot: 0, full: false };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

test("RoomReady round-trips (slot 1, full)", () => {
  const m: RoomReady = { type: "RoomReady", slot: 1, full: true };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

// ── PlayerInput ───────────────────────────────────────────────────────────────

test("PlayerInput round-trips (single frame, slot 0)", () => {
  const m: PlayerInput = {
    type: "PlayerInput",
    slot: 0,
    frames: [{ seq: 1, input: { ...EMPTY_INPUT, moveX: 0.5, jumpHeld: true } }],
  };
  expect(deserializePlayerInput(serializePlayerInput(m))).toEqual(m);
});

test("PlayerInput round-trips (multiple frames with redundant tail)", () => {
  const m: PlayerInput = {
    type: "PlayerInput",
    slot: 1,
    frames: [
      { seq: 5, input: { ...EMPTY_INPUT, moveX: -1 } },
      { seq: 4, input: { ...EMPTY_INPUT, moveX: -0.8 } },
      { seq: 3, input: EMPTY_INPUT },
    ],
  };
  expect(deserializePlayerInput(serializePlayerInput(m))).toEqual(m);
});

// ── InputAck ──────────────────────────────────────────────────────────────────

test("InputAck round-trips", () => {
  const m: InputAck = { type: "InputAck", lastAckedSeq: [12, 10] };
  expect(deserializeInputAck(serializeInputAck(m))).toEqual(m);
});

test("InputAck round-trips (zero acked)", () => {
  const m: InputAck = { type: "InputAck", lastAckedSeq: [0, 0] };
  expect(deserializeInputAck(serializeInputAck(m))).toEqual(m);
});

// ── WorldSnapshot ─────────────────────────────────────────────────────────────

function makeSnapshot(): WorldSnapshot {
  return {
    type: "WorldSnapshot",
    serverTick: 42,
    players: [
      {
        x: 1.5,
        y: 0.75,
        vx: 2.0,
        vy: 0.0,
        facing: 1,
        grounded: true,
        charge: 0,
        knockdownTicks: 0,
        invulnTicks: 0,
      },
      {
        x: -1.5,
        y: 0.75,
        vx: -1.5,
        vy: 0.1,
        facing: -1,
        grounded: false,
        charge: 5,
        knockdownTicks: 0,
        invulnTicks: 3,
      },
    ],
    ball: { x: 0, y: 3, vx: 4, vy: 8 },
    rapierBytesB64: btoa("fake-rapier-bytes"),
    match: {
      phase: "playing",
      scores: [1, 0],
      timer: 1800,
      pauseTicks: 0,
      resetTicks: 0,
      winner: -1,
      timerExpired: false,
    },
    lastAckedSeq: [5, 4],
  };
}

test("WorldSnapshot round-trips", () => {
  const m = makeSnapshot();
  expect(deserializeWorldSnapshot(serializeWorldSnapshot(m))).toEqual(m);
});

test("WorldSnapshot round-trips with rapierBytesB64 preserved", () => {
  const m = makeSnapshot();
  const decoded = deserializeWorldSnapshot(serializeWorldSnapshot(m));
  expect(decoded.rapierBytesB64).toBe(m.rapierBytesB64);
});

test("WorldSnapshot round-trips with all match phases", () => {
  const phases = [
    "preRound",
    "playing",
    "bellPause",
    "resetting",
    "goldenGoal",
    "complete",
  ] as const;
  for (const phase of phases) {
    const m = makeSnapshot();
    m.match.phase = phase;
    expect(
      deserializeWorldSnapshot(serializeWorldSnapshot(m)).match.phase,
    ).toBe(phase);
  }
});

// ── MatchClosed ───────────────────────────────────────────────────────────────

test("MatchClosed round-trips (peer-left)", () => {
  const m: MatchClosed = { type: "MatchClosed", reason: "peer-left" };
  expect(deserializeMatchClosed(serializeMatchClosed(m))).toEqual(m);
});

test("MatchClosed round-trips (server-shutdown)", () => {
  const m: MatchClosed = { type: "MatchClosed", reason: "server-shutdown" };
  expect(deserializeMatchClosed(serializeMatchClosed(m))).toEqual(m);
});

test("MatchClosed preserves reason after round-trip", () => {
  const m: MatchClosed = { type: "MatchClosed", reason: "peer-left" };
  const decoded = deserializeMatchClosed(serializeMatchClosed(m));
  expect(decoded.reason).toBe("peer-left");
  expect(decoded.type).toBe("MatchClosed");
});

// ── Telemetry ─────────────────────────────────────────────────────────────────

test("Telemetry round-trips (typical values)", () => {
  const m: Telemetry = { type: "Telemetry", rtt: 42, ackLag: 3 };
  expect(deserializeTelemetry(serializeTelemetry(m))).toEqual(m);
});

test("Telemetry round-trips (zero values)", () => {
  const m: Telemetry = { type: "Telemetry", rtt: 0, ackLag: 0 };
  expect(deserializeTelemetry(serializeTelemetry(m))).toEqual(m);
});

test("Telemetry round-trips (high latency)", () => {
  const m: Telemetry = { type: "Telemetry", rtt: 500, ackLag: 15 };
  const decoded = deserializeTelemetry(serializeTelemetry(m));
  expect(decoded.rtt).toBe(500);
  expect(decoded.ackLag).toBe(15);
});
