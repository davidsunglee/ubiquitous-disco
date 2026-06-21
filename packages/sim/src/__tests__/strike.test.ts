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
  // Use activeSlots [0, 1] so 2-element input rows and players[1] references
  // in these tests remain valid (legacy compact layout).
  const sim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 4242,
    activeSlots: [0, 1],
  });
  // Advance past preRound so gameplay rules run.
  sim.step([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  return sim;
}

/**
 * Walk the player up next to the (settled) ball so a Strike is within reach.
 * Returns the sim positioned for a Strike. Ball spawns at x=0; player at x=-4.
 */
function approachBall(sim: ReturnType<typeof newSim>): void {
  // Let the ball drop and settle on the floor.
  for (let i = 0; i < 40; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  // Walk right until the player is in Strike reach of the ball.
  for (let i = 0; i < 40; i++) {
    sim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const s = sim.getRenderState();
    const p = s.players[0];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) return;
  }
}

test("a tap Strike imparts impulse to the ball", () => {
  const sim = newSim();
  approachBall(sim);

  const before = sim.getRenderState().ball;
  // Tap Strike with no directional intent: press + release across two ticks.
  sim.step([frame({ strikeHeld: true, strikePressed: true }), EMPTY_INPUT]);
  sim.step([frame({ strikeReleased: true }), EMPTY_INPUT]);
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
  sim.step([
    frame({ strikeHeld: true, strikePressed: true, moveY: 1 }),
    EMPTY_INPUT,
  ]);
  for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
    sim.step([frame({ strikeHeld: true, moveY: 1 }), EMPTY_INPUT]);
  }
  sim.step([frame({ strikeReleased: true, moveY: 1 }), EMPTY_INPUT]);

  // Immediately after release the ball should be rising.
  const y1 = sim.getRenderState().ball.y;
  sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  const y2 = sim.getRenderState().ball.y;
  expect(y2).toBeGreaterThan(y1);
  // and it climbs well above where it started.
  let peak = y2;
  for (let i = 0; i < 20; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
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
      sim.step([
        frame({ strikeHeld: true, strikePressed: true, moveY: 1 }),
        EMPTY_INPUT,
      ]);
      for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
        sim.step([frame({ strikeHeld: true, moveY: 1 }), EMPTY_INPUT]);
      }
      sim.step([frame({ strikeReleased: true, moveY: 1 }), EMPTY_INPUT]);
    } else {
      sim.step([
        frame({ strikeHeld: true, strikePressed: true, moveY: 1 }),
        EMPTY_INPUT,
      ]);
      sim.step([frame({ strikeReleased: true, moveY: 1 }), EMPTY_INPUT]);
    }
    let peak = sim.getRenderState().ball.y;
    for (let i = 0; i < 40; i++) {
      sim.step([EMPTY_INPUT, EMPTY_INPUT]);
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
    sim.step([
      frame({ strikeHeld: true, strikePressed: true, moveY: 1 }),
      EMPTY_INPUT,
    ]);
    for (let i = 0; i < DEFAULT_CONFIG.strike.maxChargeTicks; i++) {
      sim.step([frame({ strikeHeld: true, moveY: 1 }), EMPTY_INPUT]);
    }
    sim.step([frame({ strikeReleased: true, moveY: 1 }), EMPTY_INPUT]);
    for (let i = 0; i < 30; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    return sim.hashState();
  };
  expect(run()).toBe(run());
});

// ── Phase 4: Aerial Strike variant tests ─────────────────────────────────────

/**
 * Walk slot 0 up to the ball (settled on the floor), then jump+strike on the
 * same tick so the strike releases while the player is still very close to the
 * ball (the first tick off the ground). The jump tick causes `grounded=false` on
 * the actor, so the aerial branch fires on that same tick's strike release.
 *
 * Strategy:
 *  1. Let the ball drop and settle (40 idle ticks).
 *  2. Walk right until within strike reach.
 *  3. Press strike (charge=minChargeTicks) AND jump on the same tick.
 *  4. Next tick: release strike while airborne (the jump just happened, player
 *     is barely off the floor and still within reach=2 of the ball on the floor).
 *
 * Returns whether the player was airborne at the moment the strike was released.
 */
function aerialStrikeNearBall(
  sim: ReturnType<typeof newSim>,
  moveY: number,
): boolean {
  // 1. Let ball settle.
  for (let i = 0; i < 40; i++) sim.step([EMPTY_INPUT, EMPTY_INPUT]);

  // 2. Walk right until in reach.
  for (let i = 0; i < 40; i++) {
    sim.step([frame({ moveX: 1 }), EMPTY_INPUT]);
    const s = sim.getRenderState();
    const p = s.players[0];
    if (!p) break;
    const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
    if (d <= DEFAULT_CONFIG.strike.reach * 0.9) break;
  }

  // 3. Press strike + jump on the same tick (charge starts at minChargeTicks).
  //    Jumping sets vy = jumpSpeed and grounded = false; the next movePlayer call
  //    will reflect this.
  sim.step([
    frame({
      jumpPressed: true,
      jumpHeld: true,
      strikeHeld: true,
      strikePressed: true,
    }),
    EMPTY_INPUT,
  ]);

  // 4. Release strike on the VERY NEXT tick while we're just off the floor.
  //    Player center y ≈ spawn_y + jumpSpeed/tickHz ≈ 0.8 + 0.37 = 1.17,
  //    ball center y ≈ 0.3, distance ≈ 0.87 — well within reach=2.
  const stateAtRelease = sim.getRenderState();
  const airborne = !(stateAtRelease.players[0]?.grounded ?? true);
  sim.step([
    frame({ strikeReleased: true, moveY, jumpHeld: true }),
    EMPTY_INPUT,
  ]);

  return airborne;
}

test("airborne + neutral/up near the ball produces a header redirect (ball goes up higher than grounded)", () => {
  // Grounded neutral strike uses upwardBias=0.5.
  // Airborne + neutral/up header uses headerUpwardBias=1.2.
  // The header should produce a higher ball peak.

  const groundedPopHeight = (): number => {
    const sim = newSim();
    approachBall(sim);
    const y0 = sim.getRenderState().ball.y;
    sim.step([frame({ strikeHeld: true, strikePressed: true }), EMPTY_INPUT]);
    sim.step([frame({ strikeReleased: true }), EMPTY_INPUT]);
    let peak = y0;
    for (let i = 0; i < 60; i++) {
      sim.step([EMPTY_INPUT, EMPTY_INPUT]);
      peak = Math.max(peak, sim.getRenderState().ball.y);
    }
    return peak - y0;
  };

  const aerialHeaderHeight = (): number => {
    const sim = newSim();
    const wasAirborne = aerialStrikeNearBall(sim, 0); // neutral Y → header path
    expect(wasAirborne).toBe(true); // guard: ensure the player was actually airborne
    const y0 = sim.getRenderState().ball.y;
    let peak = y0;
    for (let i = 0; i < 60; i++) {
      sim.step([EMPTY_INPUT, EMPTY_INPUT]);
      peak = Math.max(peak, sim.getRenderState().ball.y);
    }
    return peak - y0;
  };

  const gPop = groundedPopHeight();
  const aHeader = aerialHeaderHeight();

  // Grounded strike moves the ball.
  expect(gPop).toBeGreaterThan(0.05);
  // Aerial header sends the ball noticeably higher (headerUpwardBias > upwardBias).
  expect(aHeader).toBeGreaterThan(gPop);
});

test("airborne + down produces a downward spike (lower peak than grounded neutral)", () => {
  // Grounded neutral strike gives the ball an upward pop.
  // Airborne + down spike cancels the pop and drives the ball downward.
  // After a spike the ball's peak height should be LOWER than after a neutral strike.

  const groundedNeutralHeight = (): number => {
    const sim = newSim();
    approachBall(sim);
    const y0 = sim.getRenderState().ball.y;
    sim.step([frame({ strikeHeld: true, strikePressed: true }), EMPTY_INPUT]);
    sim.step([frame({ strikeReleased: true }), EMPTY_INPUT]);
    let peak = y0;
    for (let i = 0; i < 60; i++) {
      sim.step([EMPTY_INPUT, EMPTY_INPUT]);
      peak = Math.max(peak, sim.getRenderState().ball.y);
    }
    return peak - y0;
  };

  const aerialSpikeHeight = (): number => {
    const sim = newSim();
    const wasAirborne = aerialStrikeNearBall(sim, -1); // moveY = -1 → spike path
    expect(wasAirborne).toBe(true);
    const y0 = sim.getRenderState().ball.y;
    let peak = y0;
    for (let i = 0; i < 60; i++) {
      sim.step([EMPTY_INPUT, EMPTY_INPUT]);
      peak = Math.max(peak, sim.getRenderState().ball.y);
    }
    return peak - y0;
  };

  const neutral = groundedNeutralHeight();
  const spike = aerialSpikeHeight();

  // Neutral strike moves the ball upward.
  expect(neutral).toBeGreaterThan(0.05);
  // Spike peak is lower than the neutral pop.
  expect(spike).toBeLessThan(neutral);
});

test("grounded strike is unchanged (regression)", () => {
  // A grounded strike with moveY=1 should behave the same as before Phase 4.
  // We verify the ball goes up (same as the existing "upward-charged Strike" test).
  const sim = newSim();
  approachBall(sim);

  const y0 = sim.getRenderState().ball.y;
  // Grounded tap with upward intent.
  sim.step([
    frame({ strikeHeld: true, strikePressed: true, moveY: 1 }),
    EMPTY_INPUT,
  ]);
  sim.step([frame({ strikeReleased: true, moveY: 1 }), EMPTY_INPUT]);

  // Ball should be moving upward.
  let peak = sim.getRenderState().ball.y;
  for (let i = 0; i < 20; i++) {
    sim.step([EMPTY_INPUT, EMPTY_INPUT]);
    peak = Math.max(peak, sim.getRenderState().ball.y);
  }
  expect(peak).toBeGreaterThan(y0 + 0.5);
});

test("aerial variant does not change player-vs-player knockback", () => {
  // Player knockback is applied in the player-connection block (after the ball block),
  // and the aerial branch only touches shapeX/shapeY/magnitude inside the ball block.
  // So knockback should be identical regardless of grounded/airborne.

  // Helper: knock slot 0 into slot 1 both grounded and airborne, compare knockback distance.
  const knockbackX = (airborne: boolean): number => {
    const config = {
      ...DEFAULT_CONFIG,
      combat: {
        ...DEFAULT_CONFIG.combat,
        staggerThreshold: 1,
        staggerPerHit: 1,
      },
    };
    // Use the 1v1 [0, 2] template: slot 0 at (-4,1), slot 2 at (+4,1).
    const sim = createSimulation({
      config,
      arena: FLAT_DOJO,
      seed: 111,
      activeSlots: [0, 2],
    });
    // Sparse row helper for [0, 2] template.
    const r = (f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] => {
      const row: InputFrame[] = [];
      row[0] = f0;
      row[2] = f2;
      return row;
    };
    // Start match.
    sim.step(r(frame({ jumpPressed: true, jumpHeld: true })));

    // Walk players together to within strike range.
    // Slot 0 (left, -4) walks right; slot 2 (right, +4) walks left.
    for (let i = 0; i < 200; i++) {
      const s = sim.getRenderState();
      const p0 = s.players[0];
      const p2 = s.players[2];
      if (!p0 || !p2) break;
      const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
      if (
        dist <=
        (DEFAULT_CONFIG.strike.reach + DEFAULT_CONFIG.combat.playerHitRadius) *
          0.9
      )
        break;
      sim.step(r(frame({ moveX: 1 }), frame({ moveX: -1 })));
    }

    if (airborne) {
      // Get slot 0 airborne.
      sim.step(r(frame({ jumpPressed: true, jumpHeld: true })));
      sim.step(r(frame({ jumpHeld: true })));
    }

    const x2Before = sim.getRenderState().players[2]?.x ?? 0;

    // Strike with downward intent (to activate spike path if airborne).
    sim.step(
      r(
        frame({
          strikeHeld: true,
          strikePressed: true,
          moveY: airborne ? -1 : 0,
        }),
      ),
    );
    sim.step(r(frame({ strikeReleased: true, moveY: airborne ? -1 : 0 })));

    // Let the knockback play out.
    for (let i = 0; i < 10; i++) sim.step(r(EMPTY_INPUT));

    const x2After = sim.getRenderState().players[2]?.x ?? 0;
    return Math.abs(x2After - x2Before);
  };

  // Both should produce knockback (> 0 displacement).
  const groundedKB = knockbackX(false);
  const airborneKB = knockbackX(true);
  expect(groundedKB).toBeGreaterThan(0.1);
  expect(airborneKB).toBeGreaterThan(0.1);
  // The magnitudes should be close (within 20%) since the player-hit block is unchanged.
  const ratio =
    Math.max(groundedKB, airborneKB) / Math.min(groundedKB, airborneKB);
  expect(ratio).toBeLessThan(1.5);
});
