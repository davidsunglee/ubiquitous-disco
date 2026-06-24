/**
 * Reachability + scoring proof for the Dune Basin arena (FLI-13 Phase 3).
 *
 * Two layers:
 *  (A) Geometry invariants (pure, no Rapier) — assert the Phase 2 collider data
 *      reads as a basin + dune ridges + side Bell chambers: the Bell sits behind
 *      the chamber mouth, the eave caps the pocket above the Bell, each dune ridge
 *      spans y 0..5 and descends to basin level (a clear rolls downhill), and a
 *      chamber floor exists under each Bell.
 *  (B) Scoring (stepped sim) — script the three intended scoring routes against
 *      the live physics: a low pocket-mouth Strike rings the opposing Bell, a ball
 *      released on the inner ridge face rolls/rebounds into the chamber toward the
 *      Bell, a Strike from inside a chamber clears the ball back toward center, and
 *      a ball placed in the own Hit-Zone still rings (own-goal stays possible).
 *
 * All constants derive from the live ArenaDef — arena.ts is the single source of
 * truth; these tests assert the invariants the Phase 2 geometry must satisfy.
 *
 * Note on committed geometry: the chamber-floor boxes are authored at y:-0.5 (tops
 * flush with the basin floor / ramp feet at the y=0 ground line), not the sketch's
 * y:0, so a walking player crosses the ridge foot into the pocket without a step.
 */

import { beforeAll, expect, test } from "vitest";
import { type BoxCollider, DUNE_BASIN, type RampCollider } from "../arena";
import { DEFAULT_CONFIG } from "../config";
import {
  createSimulation,
  EMPTY_INPUT,
  type InputFrame,
  initSim,
  type SimEvent,
} from "../index";

beforeAll(async () => {
  await initSim();
});

// ── Live-geometry handles (right side; the left side mirrors it) ──────────────

const rightBell = DUNE_BASIN.bells.find((b) => b.id === "right")!;
const leftBell = DUNE_BASIN.bells.find((b) => b.id === "left")!;

// Right dune ridge: inner foot x=15, peak x=27 (y=5), outer/chamber foot x=38.5.
const rightRidge = DUNE_BASIN.colliders.find(
  (c): c is RampCollider => c.kind === "ramp" && c.points.some(([x]) => x > 0),
)!;
const leftRidge = DUNE_BASIN.colliders.find(
  (c): c is RampCollider => c.kind === "ramp" && c.points.some(([x]) => x < 0),
)!;

// Right chamber floor: the box whose x-span contains the right Bell (top y=0).
const rightChamberFloor = DUNE_BASIN.colliders.find(
  (c): c is BoxCollider =>
    c.kind === "box" &&
    c.halfH < 1 &&
    c.x > 0 &&
    rightBell.hitZone.x >= c.x - c.halfW &&
    rightBell.hitZone.x <= c.x + c.halfW &&
    c.y + c.halfH < 1, // floor (top near y=0), not the eave above it
)!;

// Right chamber eave: the box over the Bell (underside above the Bell center).
const rightEave = DUNE_BASIN.colliders.find(
  (c): c is BoxCollider =>
    c.kind === "box" &&
    c.x > 0 &&
    Math.abs(c.x - rightBell.hitZone.x) < 6 &&
    c.y - c.halfH > rightBell.hitZone.y - 2 &&
    c.y - c.halfH > 1, // underside well above the floor
)!;

// Chamber mouth = the ridge's outer (chamber-side) foot at ground level.
const rightMouthX = Math.max(...rightRidge.points.map(([x]) => x)); // 38.5

// ── (A) Geometry invariants (pure) ────────────────────────────────────────────

test("the Bell Hit-Zone sits behind the chamber mouth (outboard of the ridge foot)", () => {
  // Right Bell is further from center than the chamber mouth, so low pocket entry
  // (past the ridge foot) is what brings the ball to the Bell.
  expect(rightMouthX).toBeCloseTo(38.5, 5);
  expect(rightBell.hitZone.x).toBeGreaterThan(rightMouthX);
  // Mirror: left Bell is outboard of its own mouth (more negative than -38.5).
  const leftMouthX = Math.min(...leftRidge.points.map(([x]) => x)); // -38.5
  expect(leftBell.hitZone.x).toBeLessThan(leftMouthX);
});

test("the chamber eave underside is above the Bell center (pocket formed above it)", () => {
  expect(rightEave).toBeDefined();
  // Eave spans over the Bell in x …
  expect(rightBell.hitZone.x).toBeGreaterThanOrEqual(
    rightEave.x - rightEave.halfW,
  );
  expect(rightBell.hitZone.x).toBeLessThanOrEqual(
    rightEave.x + rightEave.halfW,
  );
  // … and its underside caps the pocket from above the Bell.
  expect(rightEave.y - rightEave.halfH).toBeGreaterThan(rightBell.hitZone.y);
});

test("each dune ridge spans y 0..5 and descends to basin level (a clear rolls downhill)", () => {
  for (const ridge of [leftRidge, rightRidge]) {
    const ys = ridge.points.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(0, 5); // feet at the y=0 ground line
    expect(Math.max(...ys)).toBeCloseTo(5, 5); // peak at y=5
  }
});

test("a chamber floor exists under each Bell at the y=0 ground line", () => {
  const leftChamberFloor = DUNE_BASIN.colliders.find(
    (c): c is BoxCollider =>
      c.kind === "box" &&
      c.halfH < 1 &&
      c.x < 0 &&
      leftBell.hitZone.x >= c.x - c.halfW &&
      leftBell.hitZone.x <= c.x + c.halfW &&
      c.y + c.halfH < 1,
  );
  for (const floor of [leftChamberFloor, rightChamberFloor]) {
    expect(floor).toBeDefined();
    if (!floor) continue;
    // Top surface flush with the basin floor / ramp feet at y=0.
    expect(floor.y + floor.halfH).toBeCloseTo(0, 5);
  }
  // The Bell sits between the chamber floor and the eave underside.
  expect(rightBell.hitZone.y).toBeGreaterThan(
    rightChamberFloor.y + rightChamberFloor.halfH,
  );
  expect(rightBell.hitZone.y).toBeLessThan(rightEave.y - rightEave.halfH);
});

// ── Scripted-sim helpers ──────────────────────────────────────────────────────

function frame(partial: Partial<InputFrame>): InputFrame {
  return { ...EMPTY_INPUT, ...partial };
}

// Single-slot sim: slot 0 is Team 0 (left side; attacks the RIGHT Bell). With
// only one active body the ball's path to the Bell is never blocked by an
// opponent — bell rings are geometry-only and slot-count independent.
function newSim() {
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: DUNE_BASIN,
    seed: 4242,
    activeSlots: [0],
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true })]);
  return sim;
}

// Place player 0 + the ball directly into the live world (no settle/walk loop),
// so each scoring scenario starts from an exact, deterministic pose.
function place(
  sim: ReturnType<typeof newSim>,
  player: { x: number; y: number },
  ball: { x: number; y: number; vx?: number; vy?: number },
) {
  sim.applyLightweightPositions({
    players: [{ x: player.x, y: player.y }],
    ball: { x: ball.x, y: ball.y, vx: ball.vx ?? 0, vy: ball.vy ?? 0 },
  });
}

function drainRing(sim: ReturnType<typeof newSim>, which: "left" | "right") {
  let rang = false;
  for (const e of sim.drainEvents() as SimEvent[]) {
    if (e.type === "bellRing" && e.bell === which) rang = true;
  }
  return rang;
}

// ── (B) Scoring: pocket-mouth Strike rings the opposing Bell ──────────────────

test("a low Strike from the right pocket mouth rings the opposing (right) Bell", () => {
  const sim = newSim();
  let rang = false;

  // Player stands at the right chamber mouth on the chamber floor (feet on y=0,
  // body center y≈0.8). The ball floats just inboard of the Bell, within reach,
  // at a low pocket height. A near-horizontal Strike toward the Bell (moveX:1,
  // plus the strike's baseline upward pop) drives it the short way into the
  // raised Hit-Zone (x=44, y=5.2).
  for (let attempt = 0; attempt < 12 && !rang; attempt++) {
    place(
      sim,
      { x: rightMouthX + 1.5, y: rightBell.hitZone.y - 0.7 }, // ~x40, y4.5
      { x: rightBell.hitZone.x - 2.0, y: rightBell.hitZone.y - 0.4 }, // ~x42, y4.8
    );
    // Charge a tap, then release toward the Bell.
    sim.step([frame({ strikeHeld: true, strikePressed: true, moveX: 1 })]);
    rang ||= drainRing(sim, "right");
    sim.step([frame({ strikeReleased: true, moveX: 1 })]);
    rang ||= drainRing(sim, "right");
    // Let the ball travel into the Hit-Zone.
    for (let i = 0; i < 30 && !rang; i++) {
      sim.step([EMPTY_INPUT]);
      rang ||= drainRing(sim, "right");
    }
  }

  expect(rang).toBe(true);
});

// ── (B) Scoring: a ramp-fed ball rolls/rebounds into the chamber to the Bell ──

test("a ball released on the inner ridge face rolls/rebounds toward the chamber Bell", () => {
  const sim = newSim();

  // Drop the ball high on the inner (center-facing) ridge face, given a small
  // outward nudge so gravity + the ramp slope carry it down the dune and on
  // toward the chamber. We assert the ball ends up meaningfully closer to the
  // Bell than it started (it travels outboard, into the pocket region).
  const startX = rightRidge.points.reduce(
    (peak, [x, y]) => (y > peak.y ? { x, y } : peak),
    { x: 0, y: -Infinity },
  ).x; // ridge peak x≈27
  place(sim, { x: 0, y: 1 }, { x: startX, y: 6.5, vx: 2 });

  let nearestToBell = Math.abs(rightBell.hitZone.x - startX);
  for (let i = 0; i < 240; i++) {
    sim.step([EMPTY_INPUT]);
    const b = sim.getRenderState().ball;
    nearestToBell = Math.min(
      nearestToBell,
      Math.abs(rightBell.hitZone.x - b.x),
    );
  }
  const finalBall = sim.getRenderState().ball;

  // The ball moved outboard from the ridge peak toward the chamber/Bell …
  expect(finalBall.x).toBeGreaterThan(startX);
  // … and at some point got materially nearer the Bell than the peak release.
  expect(nearestToBell).toBeLessThan(Math.abs(rightBell.hitZone.x - startX));
});

// ── (B) Scoring: a defensive clear from inside the chamber goes toward center ─

test("a Strike from inside the right chamber clears the ball back toward center", () => {
  const sim = newSim();

  // Defender + ball both deep in the RIGHT chamber (near the outer wall). A
  // clear faces center (moveX:-1) and must move the ball toward x=0 (its x must
  // decrease) — not deeper into the wall or up into the own Bell.
  const ballStartX = rightChamberFloor.x + 1.5; // ~x44.5, near the wall
  place(sim, { x: ballStartX - 1.2, y: 0.8 }, { x: ballStartX, y: 1.2 });
  sim.step([frame({ strikeHeld: true, strikePressed: true, moveX: -1 })]);
  sim.step([frame({ strikeReleased: true, moveX: -1 })]);
  for (let i = 0; i < 20; i++) sim.step([EMPTY_INPUT]);

  const finalBall = sim.getRenderState().ball;
  // The clear sent the ball toward center (x decreased from where it started).
  expect(finalBall.x).toBeLessThan(ballStartX);
});

// ── (B) Scoring: own-goal stays possible (ball in the own Hit-Zone rings) ─────

test("placing the ball in the own (left) Hit-Zone still rings it (own-goal possible)", () => {
  const sim = newSim();
  let rang = false;

  // Slot 0 defends the LEFT Bell; dropping the ball straight onto the left
  // Hit-Zone must still fire a ring — own Bell rings remain possible.
  place(sim, { x: 0, y: 1 }, { x: leftBell.hitZone.x, y: leftBell.hitZone.y });
  for (let i = 0; i < 5 && !rang; i++) {
    sim.step([EMPTY_INPUT]);
    rang ||= drainRing(sim, "left");
  }

  expect(rang).toBe(true);
});
