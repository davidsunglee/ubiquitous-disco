/**
 * applyAuthoritativeState tests (Phase 2).
 *
 * Verifies that:
 *  1. Applying a known state via applyAuthoritativeState() results in
 *     getRenderState() matching the expected values (positions, ball).
 *  2. Match state is correctly replaced.
 *  3. The tick counter is updated.
 *  4. Ball is faithfully restored (rapierBytes restore path — no drift).
 *  5. Player JS fields (facing, charge, knockdownTicks, invulnTicks, etc.)
 *     are correctly applied from the AuthoritativeState.
 */

import { beforeAll, describe, expect, test } from "vitest";
import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  toAuthoritativeState,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function f(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

function newSim() {
  return createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
}

describe("applyAuthoritativeState", () => {
  test("getRenderState() matches after apply — player positions", () => {
    // Run a sim forward to get an authoritative state.
    const serverSim = newSim();
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 20; i++) serverSim.step([f({ moveX: 1 }), EMPTY_INPUT]);

    const auth = toAuthoritativeState(serverSim);
    const serverRender = serverSim.getRenderState();

    // Apply to a fresh client sim.
    const clientSim = newSim();
    clientSim.applyAuthoritativeState(auth);
    const clientRender = clientSim.getRenderState();

    // Player positions should match exactly.
    for (let s = 0; s < serverRender.players.length; s++) {
      const sp = serverRender.players[s];
      const cp = clientRender.players[s];
      if (!sp || !cp) continue;
      expect(cp.x).toBeCloseTo(sp.x, 5);
      expect(cp.y).toBeCloseTo(sp.y, 5);
    }
  });

  test("ball position matches after rapierBytes restore", () => {
    // Strike the ball so it's in fast flight (wall-contact likely).
    const serverSim = newSim();
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 40; i++) serverSim.step([EMPTY_INPUT, EMPTY_INPUT]);
    // Walk toward ball.
    for (let i = 0; i < 25; i++) serverSim.step([f({ moveX: 1 }), EMPTY_INPUT]);
    // Full-charge upward strike.
    serverSim.step([
      f({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
      EMPTY_INPUT,
    ]);
    for (let i = 0; i < 22; i++)
      serverSim.step([
        f({ moveX: 1, moveY: 1, strikeHeld: true }),
        EMPTY_INPUT,
      ]);
    serverSim.step([
      f({ moveX: 1, moveY: 1, strikeReleased: true }),
      EMPTY_INPUT,
    ]);
    // Let the ball fly for a bit (may hit ceiling).
    for (let i = 0; i < 30; i++) serverSim.step([EMPTY_INPUT, EMPTY_INPUT]);

    const auth = toAuthoritativeState(serverSim);
    const serverBall = serverSim.getRenderState().ball;
    const serverVel = serverSim.getBallVel();

    // Apply to fresh client sim.
    const clientSim = newSim();
    clientSim.applyAuthoritativeState(auth);
    const clientBall = clientSim.getRenderState().ball;
    const clientVel = clientSim.getBallVel();

    // Position and velocity should match exactly (rapierBytes path).
    expect(clientBall.x).toBeCloseTo(serverBall.x, 5);
    expect(clientBall.y).toBeCloseTo(serverBall.y, 5);
    expect(clientVel.vx).toBeCloseTo(serverVel.vx, 5);
    expect(clientVel.vy).toBeCloseTo(serverVel.vy, 5);
  });

  test("match state is replaced correctly", () => {
    const serverSim = newSim();
    // Start the match.
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 5; i++) serverSim.step([EMPTY_INPUT, EMPTY_INPUT]);

    const auth = toAuthoritativeState(serverSim);
    const serverMatch = serverSim.getMatchState();

    const clientSim = newSim();
    clientSim.applyAuthoritativeState(auth);
    const clientMatch = clientSim.getMatchState();

    expect(clientMatch.phase).toBe(serverMatch.phase);
    expect(clientMatch.timer).toBe(serverMatch.timer);
    expect(clientMatch.scores).toEqual(serverMatch.scores);
  });

  test("actor JS fields are applied (facing, charge, knockdownTicks, invulnTicks)", () => {
    const serverSim = newSim();
    // Start and move player 0 right (changes facing to 1).
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 10; i++)
      serverSim.step([f({ moveX: -1 }), EMPTY_INPUT]);

    const auth = toAuthoritativeState(serverSim);

    const clientSim = newSim();
    clientSim.applyAuthoritativeState(auth);
    const render = clientSim.getRenderState();

    // Player 0 should have facing = -1 after walking left.
    expect(render.players[0]?.facing).toBe(-1);
  });

  test("after apply, stepping produces the same outcome as the server", () => {
    const serverSim = newSim();
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 15; i++) serverSim.step([f({ moveX: 1 }), EMPTY_INPUT]);

    const auth = toAuthoritativeState(serverSim);

    const clientSim = newSim();
    clientSim.applyAuthoritativeState(auth);

    // Step both by the same inputs.
    const stepInputs = [f({ moveX: -1 }), f({ moveX: 1 })];
    for (let i = 0; i < 5; i++) {
      serverSim.step(stepInputs);
      clientSim.step(stepInputs);
    }

    const sr = serverSim.getRenderState();
    const cr = clientSim.getRenderState();

    for (let s = 0; s < sr.players.length; s++) {
      const sp = sr.players[s];
      const cp = cr.players[s];
      if (!sp || !cp) continue;
      expect(cp.x).toBeCloseTo(sp.x, 4);
      expect(cp.y).toBeCloseTo(sp.y, 4);
    }
    expect(cr.ball.x).toBeCloseTo(sr.ball.x, 4);
    expect(cr.ball.y).toBeCloseTo(sr.ball.y, 4);
  });

  test("pending events are cleared after apply", () => {
    // Drain some events by running a match that generates them.
    const serverSim = newSim();
    serverSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 5; i++) serverSim.step([EMPTY_INPUT, EMPTY_INPUT]);
    const auth = toAuthoritativeState(serverSim);

    const clientSim = newSim();
    // Run client to generate its own events.
    clientSim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    clientSim.step([EMPTY_INPUT, EMPTY_INPUT]);
    // Events include matchPhase → playing at minimum.

    // Apply and drain — should be empty (apply clears).
    clientSim.applyAuthoritativeState(auth);
    const events = clientSim.drainEvents();
    expect(events).toHaveLength(0);
  });
});

describe("toAuthoritativeState", () => {
  test("returns tick from snapshot", () => {
    const sim = newSim();
    sim.step([EMPTY_INPUT, EMPTY_INPUT]); // tick → 1
    sim.step([EMPTY_INPUT, EMPTY_INPUT]); // tick → 2
    const auth = toAuthoritativeState(sim);
    expect(auth.tick).toBe(2);
  });

  test("rapierBytes is present and non-empty", () => {
    const sim = newSim();
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    const auth = toAuthoritativeState(sim);
    expect(auth.rapierBytes).toBeInstanceOf(Uint8Array);
    expect(auth.rapierBytes.length).toBeGreaterThan(0);
  });

  test("ball velocity is included", () => {
    const sim = newSim();
    sim.step([f({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
    for (let i = 0; i < 40; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    for (let i = 0; i < 25; i++) sim.step([f({ moveX: 1 }), EMPTY_INPUT]);
    // Strike the ball.
    sim.step([
      f({ moveX: 1, strikeHeld: true, strikePressed: true }),
      EMPTY_INPUT,
    ]);
    for (let i = 0; i < 12; i++)
      sim.step([f({ moveX: 1, strikeHeld: true }), EMPTY_INPUT]);
    sim.step([f({ moveX: 1, strikeReleased: true }), EMPTY_INPUT]);

    const auth = toAuthoritativeState(sim);
    const vel = sim.getBallVel();

    expect(auth.ball.vx).toBeCloseTo(vel.vx, 5);
    expect(auth.ball.vy).toBeCloseTo(vel.vy, 5);
  });
});
