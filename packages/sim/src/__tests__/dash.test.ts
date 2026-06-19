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

// Deepest overlap of the player's AABB into any static arena collider. The blink
// is folded into the single movement sweep, so it must clamp at first contact and
// never let held walk/jump velocity drive the player into geometry afterward.
const PHW = DEFAULT_CONFIG.player.halfW;
const PHH = DEFAULT_CONFIG.player.halfH;
function staticPenetration(px: number, py: number): number {
  let worst = 0;
  for (const c of FLAT_DOJO.colliders) {
    const ox = PHW + c.halfW - Math.abs(px - c.x);
    const oy = PHH + c.halfH - Math.abs(py - c.y);
    if (ox > 1e-4 && oy > 1e-4) worst = Math.max(worst, Math.min(ox, oy));
  }
  return worst;
}

// Run a scripted lead-in, then a dash, then a settle; assert the player never
// penetrates static geometry by more than the controller's skin offset.
function worstPenetrationThrough(lead: InputFrame[], settle = 25): number {
  const sim = newSim();
  let worst = 0;
  const track = () => {
    const p = sim.getRenderState().player;
    worst = Math.max(worst, staticPenetration(p.x, p.y));
  };
  for (const f of lead) {
    sim.step(f);
    track();
  }
  for (let i = 0; i < settle; i++) {
    sim.step(EMPTY_INPUT);
    track();
  }
  return worst;
}

const SKIN = 0.02; // controller offset (0.01) plus numeric slop

test("a downward Tele-Dash is clamped by the floor, not through it", () => {
  // Jump, then blink straight down into the floor (top surface at y = 0).
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  lead.push(frame({ jumpPressed: true, jumpHeld: true }));
  lead.push(frame({ jumpHeld: true }));
  lead.push(
    frame({ moveY: -1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  expect(worstPenetrationThrough(lead)).toBeLessThan(SKIN);
});

test("a sideways Tele-Dash is clamped by a suspended platform's face", () => {
  // Walk toward the right overhang (x ∈ [6,10]), jump to its height, then blink
  // right into its left face while holding right (the held walk must not push in).
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  for (let i = 0; i < 33; i++) lead.push(frame({ moveX: 1 }));
  lead.push(frame({ jumpPressed: true, jumpHeld: true, moveX: 1 }));
  for (let i = 0; i < 10; i++) lead.push(frame({ jumpHeld: true, moveX: 1 }));
  lead.push(
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  expect(worstPenetrationThrough(lead)).toBeLessThan(SKIN);
});

test("an upward Tele-Dash is clamped by a suspended platform's underside", () => {
  // Stand under the overhang (underside at y = 3) and blink straight up into it;
  // the full-distance blink must stop at the underside, not punch through.
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  for (let i = 0; i < 70; i++) lead.push(frame({ moveX: 1 }));
  lead.push(frame({ moveY: 1, dashPressed: true, dashHeld: true }));
  expect(worstPenetrationThrough(lead)).toBeLessThan(SKIN);
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
