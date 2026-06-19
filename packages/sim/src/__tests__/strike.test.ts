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
    seed: 4242,
  });
}

/**
 * Walk the player up next to the (settled) ball so a Strike is within reach.
 * Returns the sim positioned for a Strike. Ball spawns at x=0; player at x=-4.
 */
function approachBall(sim: ReturnType<typeof newSim>): void {
  // Let the ball drop and settle on the floor.
  for (let i = 0; i < 40; i++) sim.step(EMPTY_INPUT);
  // Walk right until the player is in Strike reach of the ball.
  for (let i = 0; i < 40; i++) {
    sim.step(frame({ moveX: 1 }));
    const s = sim.getRenderState();
    const d = Math.hypot(s.ball.x - s.player.x, s.ball.y - s.player.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) return;
  }
}

test("a tap Strike imparts impulse to the ball", () => {
  const sim = newSim();
  approachBall(sim);

  const before = sim.getRenderState().ball;
  // Tap Strike with no directional intent: press + release across two ticks.
  sim.step(frame({ strikeHeld: true, strikePressed: true }));
  sim.step(frame({ strikeReleased: true }));
  const after = sim.getRenderState().ball;

  // The ball gained noticeable velocity (it moved off its resting position).
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  expect(moved).toBeGreaterThan(0.05);
});

test("an upward-charged Strike yields upward ball velocity", () => {
  const sim = newSim();
  approachBall(sim);

  const y0 = sim.getRenderState().ball.y;
  // Hold Strike up to charge, holding moveY up for an upward pop, then release.
  sim.step(frame({ strikeHeld: true, strikePressed: true, moveY: 1 }));
  for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
    sim.step(frame({ strikeHeld: true, moveY: 1 }));
  }
  sim.step(frame({ strikeReleased: true, moveY: 1 }));

  // Immediately after release the ball should be rising.
  const y1 = sim.getRenderState().ball.y;
  sim.step(EMPTY_INPUT);
  const y2 = sim.getRenderState().ball.y;
  expect(y2).toBeGreaterThan(y1);
  // and it climbs well above where it started.
  let peak = y2;
  for (let i = 0; i < 20; i++) {
    sim.step(EMPTY_INPUT);
    peak = Math.max(peak, sim.getRenderState().ball.y);
  }
  expect(peak).toBeGreaterThan(y0 + 0.5);
});

test("a charged Strike pops the ball higher than a tap Strike", () => {
  const popHeight = (charged: boolean): number => {
    const sim = newSim();
    approachBall(sim);
    const y0 = sim.getRenderState().ball.y;
    if (charged) {
      sim.step(frame({ strikeHeld: true, strikePressed: true, moveY: 1 }));
      for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
        sim.step(frame({ strikeHeld: true, moveY: 1 }));
      }
      sim.step(frame({ strikeReleased: true, moveY: 1 }));
    } else {
      sim.step(frame({ strikeHeld: true, strikePressed: true, moveY: 1 }));
      sim.step(frame({ strikeReleased: true, moveY: 1 }));
    }
    let peak = sim.getRenderState().ball.y;
    for (let i = 0; i < 40; i++) {
      sim.step(EMPTY_INPUT);
      peak = Math.max(peak, sim.getRenderState().ball.y);
    }
    return peak - y0;
  };
  expect(popHeight(true)).toBeGreaterThan(popHeight(false));
});

test("scripted Strike session produces an equal composite hash across runs", () => {
  const run = (): string => {
    const sim = newSim();
    approachBall(sim);
    sim.step(frame({ strikeHeld: true, strikePressed: true, moveY: 1 }));
    for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
      sim.step(frame({ strikeHeld: true, moveY: 1 }));
    }
    sim.step(frame({ strikeReleased: true, moveY: 1 }));
    for (let i = 0; i < 30; i++) sim.step(EMPTY_INPUT);
    return sim.hashState();
  };
  expect(run()).toBe(run());
});
