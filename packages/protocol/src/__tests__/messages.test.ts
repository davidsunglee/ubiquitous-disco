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

test("RoomReady round-trips (slot 0, not full, 1v1 template)", () => {
  const m: RoomReady = {
    type: "RoomReady",
    slot: 0,
    full: false,
    slots: [0, 2],
    characters: ["sifu", "sifu"],
    arenaId: "flat-dojo",
  };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

test("RoomReady round-trips (slot 2, full, 1v1 template)", () => {
  const m: RoomReady = {
    type: "RoomReady",
    slot: 2,
    full: true,
    slots: [0, 2],
    characters: ["vipra", "panda"],
    arenaId: "flat-dojo",
  };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

test("RoomReady round-trips (slot 1, full, 2v2 template)", () => {
  const m: RoomReady = {
    type: "RoomReady",
    slot: 1,
    full: true,
    slots: [0, 1, 2, 3],
    characters: ["sifu", "monkey-king", "old-master", "drunken-boxer"],
    arenaId: "pillared-temple",
  };
  expect(deserializeRoomReady(serializeRoomReady(m))).toEqual(m);
});

test("RoomReady preserves per-slot characterIds after round-trip", () => {
  const m: RoomReady = {
    type: "RoomReady",
    slot: 0,
    full: true,
    slots: [0, 2],
    characters: ["panda", "vipra"],
    arenaId: "twin-ledge",
  };
  const decoded = deserializeRoomReady(serializeRoomReady(m));
  expect(decoded.characters).toEqual(["panda", "vipra"]);
  expect(decoded.arenaId).toBe("twin-ledge");
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

test("InputAck round-trips (four-entry AckBySlot)", () => {
  const m: InputAck = { type: "InputAck", lastAckedSeq: [12, 0, 10, 0] };
  expect(deserializeInputAck(serializeInputAck(m))).toEqual(m);
});

test("InputAck round-trips (zero acked)", () => {
  const m: InputAck = { type: "InputAck", lastAckedSeq: [0, 0, 0, 0] };
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
        ticksSinceGrounded: 0,
        dashCooldown: 0,
        airDashAvailable: true,
        stagger: 0,
        controlLock: false,
        staggerDecayDelay: 0,
        specialCooldown: 0,
        airJumpsRemaining: 1,
        strikeActiveTicks: 0,
        strikeImpulseX: 0,
        strikeImpulseY: 0,
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
        ticksSinceGrounded: 4,
        dashCooldown: 7,
        airDashAvailable: false,
        stagger: 2.5,
        controlLock: false,
        staggerDecayDelay: 5,
        specialCooldown: 42,
        airJumpsRemaining: 0,
        strikeActiveTicks: 2,
        strikeImpulseX: 3.25,
        strikeImpulseY: -1.5,
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
    bellRing: {
      armed: [true, false],
      radiusBonus: 0.25,
      rampTicks: 7,
    },
    rngState: 0x1234_abcd,
    lastAckedSeq: [5, 0, 4, 0],
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
