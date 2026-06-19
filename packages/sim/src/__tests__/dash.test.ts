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

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

function newSim() {
  return createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
}

test("Tele-Dash blinks a fixed distance in the move direction", () => {
  const sim = newSim();
  // settle on the floor
  for (let i = 0; i < 10; i++) sim.step(EMPTY_INPUT);
  const startX = sim.getRenderState().player.x;
  sim.step(frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const afterX = sim.getRenderState().player.x;
  // moved roughly the configured dash distance to the right
  expect(afterX - startX).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});

test("Dash is gated by its cooldown", () => {
  const sim = newSim();
  for (let i = 0; i < 10; i++) sim.step(EMPTY_INPUT);

  const x0 = sim.getRenderState().player.x;
  sim.step(frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x1 = sim.getRenderState().player.x;
  expect(x1 - x0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);

  // Immediately attempting another Dash while on cooldown does nothing big.
  sim.step(frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x2 = sim.getRenderState().player.x;
  expect(x2 - x1).toBeLessThan(DEFAULT_CONFIG.dash.distance * 0.5);

  // After the cooldown elapses, a Dash works again.
  for (let i = 0; i < DEFAULT_CONFIG.dash.cooldownTicks; i++) {
    sim.step(EMPTY_INPUT);
  }
  const x3 = sim.getRenderState().player.x;
  sim.step(frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x4 = sim.getRenderState().player.x;
  expect(x4 - x3).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});

test("exactly one air-dash per airtime, reset on landing", () => {
  const sim = newSim();
  for (let i = 0; i < 10; i++) sim.step(EMPTY_INPUT);

  // Jump straight up (full-height, ~33 ticks of airtime).
  sim.step(frame({ jumpPressed: true, jumpHeld: true }));
  sim.step(frame({ jumpHeld: true }));
  expect(sim.getRenderState().player.grounded).toBe(false);

  // First air-dash connects (a horizontal blink preserves the jump arc).
  const a0 = sim.getRenderState().player.x;
  sim.step(
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const a1 = sim.getRenderState().player.x;
  expect(a1 - a0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);

  // Wait past the cooldown while staying airborne — the second air-dash must be
  // denied because the per-airtime budget is spent, even though cooldown is ready.
  for (let i = 0; i < DEFAULT_CONFIG.dash.cooldownTicks; i++) {
    sim.step(frame({ jumpHeld: true }));
    if (sim.getRenderState().player.grounded) break;
  }
  expect(sim.getRenderState().player.grounded).toBe(false);
  const b0 = sim.getRenderState().player.x;
  sim.step(
    frame({ moveX: -1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const b1 = sim.getRenderState().player.x;
  expect(Math.abs(b1 - b0)).toBeLessThan(DEFAULT_CONFIG.dash.distance * 0.5);

  // Land, then the air-dash budget is available again.
  for (let i = 0; i < 80; i++) sim.step(EMPTY_INPUT);
  expect(sim.getRenderState().player.grounded).toBe(true);

  // Jump and immediately air-dash to prove the budget reset on landing.
  sim.step(frame({ jumpPressed: true, jumpHeld: true }));
  sim.step(frame({ jumpHeld: true }));
  const d0 = sim.getRenderState().player.x;
  sim.step(
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const d1 = sim.getRenderState().player.x;
  expect(d1 - d0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});
