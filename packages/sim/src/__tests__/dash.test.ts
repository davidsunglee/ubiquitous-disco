import { beforeAll, expect, test } from "vitest";
import {
  type ArenaDef,
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  TEMPLE_ASCENT,
  TWIN_LEDGE,
} from "../index";

beforeAll(async () => {
  await initSim();
});

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

function newSim() {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 1234,
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  return sim;
}

// Helper: step all slots with the given slot-0 frame, slot-1 idle.
function step0(sim: ReturnType<typeof newSim>, f: InputFrame) {
  return sim.step([f, EMPTY_INPUT]);
}

test("Tele-Dash blinks a fixed distance in the move direction", () => {
  const sim = newSim();
  // settle on the floor
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  const startX = sim.getRenderState().players[0]?.x ?? 0;
  step0(sim, frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const afterX = sim.getRenderState().players[0]?.x ?? 0;
  // moved roughly the configured dash distance to the right
  expect(afterX - startX).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});

test("Dash is gated by its cooldown", () => {
  const sim = newSim();
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  const x0 = sim.getRenderState().players[0]?.x ?? 0;
  step0(sim, frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x1 = sim.getRenderState().players[0]?.x ?? 0;
  expect(x1 - x0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);

  // Immediately attempting another Dash while on cooldown does nothing big.
  step0(sim, frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x2 = sim.getRenderState().players[0]?.x ?? 0;
  expect(x2 - x1).toBeLessThan(DEFAULT_CONFIG.dash.distance * 0.5);

  // After the cooldown elapses, a Dash works again.
  for (let i = 0; i < DEFAULT_CONFIG.dash.cooldownTicks; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  }
  const x3 = sim.getRenderState().players[0]?.x ?? 0;
  step0(sim, frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  const x4 = sim.getRenderState().players[0]?.x ?? 0;
  expect(x4 - x3).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});

// Deepest overlap of the player's AABB into any static arena collider. The blink
// is folded into the single movement sweep, so it must clamp at first contact and
// never let held walk/jump velocity drive the player into geometry afterward.
const PHW = DEFAULT_CONFIG.player.halfW;
const PHH = DEFAULT_CONFIG.player.halfH;
function staticPenetration(arena: ArenaDef, px: number, py: number): number {
  let worst = 0;
  for (const c of arena.colliders) {
    // Ramps are convex-hull shapes with no box halfW/halfH; skip them here.
    // Ramp solidity is proven by the no-slip-under assertion in ramp.test.ts.
    if (c.kind !== "box") continue;
    const ox = PHW + c.halfW - Math.abs(px - c.x);
    const oy = PHH + c.halfH - Math.abs(py - c.y);
    if (ox > 1e-4 && oy > 1e-4) worst = Math.max(worst, Math.min(ox, oy));
  }
  return worst;
}

// Run a scripted lead-in, then a dash, then a settle; assert the player never
// penetrates static geometry by more than the controller's skin offset.
function worstPenetrationThrough(
  arena: ArenaDef,
  lead: InputFrame[],
  settle = 25,
): number {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena,
    seed: 1234,
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  let worst = 0;
  const track = () => {
    const p = sim.getRenderState().players[0];
    if (p) worst = Math.max(worst, staticPenetration(arena, p.x, p.y));
  };
  for (const f of lead) {
    sim.step([f, EMPTY_INPUT]);
    track();
  }
  for (let i = 0; i < settle; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    track();
  }
  return worst;
}

const SKIN = 0.02; // controller offset (0.01) plus numeric slop

test("a downward Tele-Dash is clamped by the floor, not through it", () => {
  // Jump, then blink straight down into the floor (top surface at y = 0).
  // Flat Dojo: floor at y=0 (retained from the original layout).
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  lead.push(frame({ jumpPressed: true, jumpHeld: true }));
  lead.push(frame({ jumpHeld: true }));
  lead.push(
    frame({ moveY: -1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  expect(worstPenetrationThrough(FLAT_DOJO, lead)).toBeLessThan(SKIN);
});

test("a sideways Tele-Dash is clamped by a suspended platform's face", () => {
  // Walk toward the outer pillar in TEMPLE_ASCENT (x=±28, top y=3.0).
  // From spawn at x=-4, walk right toward the right inner pillar (x=12)
  // then jump to its height and blink right into the outer pillar face (x=28).
  // With moveSpeed 7.2 (0.24u/tick), ~68 ticks reach x≈12; jump up and dash right.
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  for (let i = 0; i < 55; i++) lead.push(frame({ moveX: 1 }));
  lead.push(frame({ jumpPressed: true, jumpHeld: true, moveX: 1 }));
  for (let i = 0; i < 10; i++) lead.push(frame({ jumpHeld: true, moveX: 1 }));
  lead.push(
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  expect(worstPenetrationThrough(TEMPLE_ASCENT, lead)).toBeLessThan(SKIN);
});

test("an upward Tele-Dash is clamped by a suspended platform's underside", () => {
  // Walk under the inner ledge in TWIN_LEDGE (inner underside ≈ y=2.0).
  // Walk right from spawn, then blink straight up into the inner ledge underside.
  // With moveSpeed 7.2 (0.24u/tick), ~55 ticks puts the player near x=9 under the
  // inner ledge (x=±16, halfW=4, underside y=2.5-0.5=2.0).
  const lead: InputFrame[] = [];
  for (let i = 0; i < 10; i++) lead.push(EMPTY_INPUT);
  for (let i = 0; i < 40; i++) lead.push(frame({ moveX: 1 }));
  lead.push(frame({ moveY: 1, dashPressed: true, dashHeld: true }));
  expect(worstPenetrationThrough(TWIN_LEDGE, lead)).toBeLessThan(SKIN);
});

test("exactly one air-dash per airtime, reset on landing", () => {
  const sim = newSim();
  for (let i = 0; i < 10; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  // Jump straight up (full-height, longer airtime due to floaty physics).
  step0(sim, frame({ jumpPressed: true, jumpHeld: true }));
  step0(sim, frame({ jumpHeld: true }));
  expect(sim.getRenderState().players[0]?.grounded).toBe(false);

  // First air-dash connects (a horizontal blink preserves the jump arc).
  const a0 = sim.getRenderState().players[0]?.x ?? 0;
  step0(
    sim,
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const a1 = sim.getRenderState().players[0]?.x ?? 0;
  expect(a1 - a0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);

  // Wait past the cooldown while staying airborne — the second air-dash must be
  // denied because the per-airtime budget is spent, even though cooldown is ready.
  for (let i = 0; i < DEFAULT_CONFIG.dash.cooldownTicks; i++) {
    step0(sim, frame({ jumpHeld: true }));
    if (sim.getRenderState().players[0]?.grounded) break;
  }
  expect(sim.getRenderState().players[0]?.grounded).toBe(false);
  const b0 = sim.getRenderState().players[0]?.x ?? 0;
  step0(
    sim,
    frame({ moveX: -1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const b1 = sim.getRenderState().players[0]?.x ?? 0;
  expect(Math.abs(b1 - b0)).toBeLessThan(DEFAULT_CONFIG.dash.distance * 0.5);

  // Land, then the air-dash budget is available again.
  // Extended settle loop for the longer floaty airtime.
  for (let i = 0; i < 120; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    if (sim.getRenderState().players[0]?.grounded) break;
  }
  expect(sim.getRenderState().players[0]?.grounded).toBe(true);

  // Jump and immediately air-dash to prove the budget reset on landing.
  step0(sim, frame({ jumpPressed: true, jumpHeld: true }));
  step0(sim, frame({ jumpHeld: true }));
  const d0 = sim.getRenderState().players[0]?.x ?? 0;
  step0(
    sim,
    frame({ moveX: 1, dashPressed: true, dashHeld: true, jumpHeld: true }),
  );
  const d1 = sim.getRenderState().players[0]?.x ?? 0;
  expect(d1 - d0).toBeGreaterThan(DEFAULT_CONFIG.dash.distance * 0.8);
});
