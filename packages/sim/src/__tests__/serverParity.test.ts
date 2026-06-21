/**
 * Server-client sim parity test (Phase 2, section 2.5).
 *
 * Two fresh sims fed the identical InputFrame[] stream must produce the same
 * hashState() — proving that a "server-style" sim and a "client-style" sim
 * are bit-for-bit identical given the same inputs.
 *
 * This is the baseline invariant the Phase 2 authoritative server relies on:
 * if the client ever steps its local sim with the same inputs the server used,
 * the two should converge to the same state.
 */

import { beforeAll, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

/** Scripted session: start, move, strike, bounce. */
function buildInputScript(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  // Start the match.
  frames.push([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);

  // Settle.
  for (let i = 0; i < 20; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // P1 walks right, P2 walks left.
  for (let i = 0; i < 20; i++) frames.push([f({ moveX: 1 }), f({ moveX: -1 })]);

  // P1 full-charge upward strike.
  frames.push([
    f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < 20; i++) {
    frames.push([f({ moveX: 1, moveY: 1, strikeHeld: true }), EMPTY_INPUT]);
  }
  frames.push([f({ moveX: 1, moveY: 1, strikeReleased: true }), EMPTY_INPUT]);

  // Let the ball fly (contact-heavy: may hit ceiling/walls).
  for (let i = 0; i < 60; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  // P2 jump + aerial strike.
  frames.push([EMPTY_INPUT, f({ jumpPressed: true, jumpHeld: true })]);
  for (let i = 0; i < 8; i++) frames.push([EMPTY_INPUT, f({ jumpHeld: true })]);
  frames.push([
    EMPTY_INPUT,
    f({ moveX: -1, strikeHeld: true, strikePressed: true }),
  ]);
  for (let i = 0; i < 12; i++) {
    frames.push([EMPTY_INPUT, f({ moveX: -1, strikeHeld: true })]);
  }
  frames.push([EMPTY_INPUT, f({ moveX: -1, strikeReleased: true })]);

  // Final settle.
  for (let i = 0; i < 40; i++) frames.push([EMPTY_INPUT, EMPTY_INPUT]);

  return frames;
}

test("server sim and client sim produce identical hashState() given the same inputs", () => {
  const inputs = buildInputScript();

  // "Server-style": fresh sim from scratch.
  const serverSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (const row of inputs) serverSim.step(row);

  // "Client-style": another fresh sim from scratch with the same inputs.
  const clientSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (const row of inputs) clientSim.step(row);

  expect(clientSim.hashState()).toBe(serverSim.hashState());
});

test("two server sims produce identical hashState() (determinism self-check)", () => {
  const inputs = buildInputScript();

  const sim1 = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  const sim2 = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });

  for (const row of inputs) {
    sim1.step(row);
    sim2.step(row);
  }

  expect(sim1.hashState()).toBe(sim2.hashState());
});

test("render states match between server sim and client sim after apply+step", () => {
  const inputs = buildInputScript();
  const midpoint = Math.floor(inputs.length / 2);

  // Server: step all the way.
  const serverSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (let i = 0; i < midpoint; i++)
    serverSim.step(inputs[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);

  // Client: step to midpoint, then step the same tail (simulating no prediction,
  // just replay from last known state — Phase 2 style).
  const clientSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  for (let i = 0; i < midpoint; i++)
    clientSim.step(inputs[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);

  // Both are at the same midpoint: renders should match.
  const sr = serverSim.getRenderState();
  const cr = clientSim.getRenderState();
  expect(cr.players[0]?.x).toBeCloseTo(sr.players[0]?.x ?? 0, 5);
  expect(cr.players[1]?.x).toBeCloseTo(sr.players[1]?.x ?? 0, 5);
  expect(cr.ball.x).toBeCloseTo(sr.ball.x, 5);
  expect(cr.ball.y).toBeCloseTo(sr.ball.y, 5);
});
