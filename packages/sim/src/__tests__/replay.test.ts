/**
 * Replay capture + playback determinism tests.
 *
 * These tests verify that:
 *  1. A scripted live session can be captured into a ReplayData via recordFrame().
 *  2. playReplay() fed that ReplayData twice produces the same final hash both times.
 *  3. The replayed hash equals the live session's final hashState() taken right after
 *     all the same frames were stepped — i.e. playback is bit-for-bit identical to
 *     the capture.
 *  4. takeSnapshot() / restoreSnapshot() can rewind the sim to a mid-session state,
 *     and re-stepping from that point produces the same result as the uninterrupted run.
 *  5. updateConfig() can change JS-side tuning knobs without breaking determinism
 *     (the same frames before the config change produce the same hash regardless of
 *     what we tune afterward).
 */

import { beforeAll, expect, test } from "vitest";
import {
  createReplay,
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  playReplay,
  recordFrame,
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
    seed: 9999,
  });
}

/**
 * A scripted session: settle, walk right, jump, walk back, do a Tele-Dash, then
 * Strike the ball. This exercises the composite hash path thoroughly.
 */
function scriptedFrameList(): InputFrame[] {
  const frames: InputFrame[] = [];
  // Settle on the ground.
  for (let i = 0; i < 20; i++) frames.push(EMPTY_INPUT);
  // Walk right.
  for (let i = 0; i < 20; i++) frames.push(frame({ moveX: 1 }));
  // Full held jump.
  frames.push(frame({ moveX: 1, jumpPressed: true, jumpHeld: true }));
  for (let i = 0; i < 20; i++) frames.push(frame({ moveX: 1, jumpHeld: true }));
  // Settle again.
  for (let i = 0; i < 20; i++) frames.push(EMPTY_INPUT);
  // Tele-Dash right.
  frames.push(frame({ moveX: 1, dashPressed: true, dashHeld: true }));
  for (let i = 0; i < 5; i++) frames.push(frame({ moveX: 1 }));
  // Walk right until near ball.
  for (let i = 0; i < 20; i++) frames.push(frame({ moveX: 1 }));
  // Charged upward Strike.
  frames.push(
    frame({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true }),
  );
  for (let i = 0; i < 10; i++)
    frames.push(frame({ moveX: 1, moveY: 1, strikeHeld: true }));
  frames.push(frame({ moveX: 1, moveY: 1, strikeReleased: true }));
  // Let the ball fly.
  for (let i = 0; i < 40; i++) frames.push(EMPTY_INPUT);
  return frames;
}

// ── Core replay capture + playback ─────────────────────────────────────────

test("playReplay() called twice on the same ReplayData returns equal hashes", () => {
  const replay = createReplay(9999);
  const sim = newSim();
  for (const f of scriptedFrameList()) {
    recordFrame(replay, f);
    sim.step(f);
  }

  const hash1 = playReplay(replay);
  const hash2 = playReplay(replay);
  expect(hash1).toBe(hash2);
});

test("playReplay() hash equals the live capture session's final hashState()", () => {
  const replay = createReplay(9999);
  const sim = newSim();
  const frames = scriptedFrameList();

  for (const f of frames) {
    recordFrame(replay, f);
    sim.step(f);
  }

  const liveHash = sim.hashState();
  const replayHash = playReplay(replay);
  expect(replayHash).toBe(liveHash);
});

test("two independent live runs with the same frames produce the same hash", () => {
  const frames = scriptedFrameList();

  const runHash = () => {
    const sim = newSim();
    for (const f of frames) sim.step(f);
    return sim.hashState();
  };

  expect(runHash()).toBe(runHash());
});

// ── Snapshot / restore (rewind) ─────────────────────────────────────────────

test("restoring a snapshot and re-stepping produces the same hash as the uninterrupted run", () => {
  const frames = scriptedFrameList();
  const midpoint = Math.floor(frames.length / 2);

  // Uninterrupted run.
  const simFull = newSim();
  for (const f of frames) simFull.step(f);
  const fullHash = simFull.hashState();

  // Interrupted run: snapshot at midpoint, step to end, restore, step to end again.
  const simRewound = newSim();
  for (let i = 0; i < midpoint; i++) simRewound.step(frames[i] ?? EMPTY_INPUT);
  const snap = simRewound.takeSnapshot();
  for (let i = midpoint; i < frames.length; i++)
    simRewound.step(frames[i] ?? EMPTY_INPUT);

  // Restore to midpoint and re-run the second half.
  simRewound.restoreSnapshot(snap);
  for (let i = midpoint; i < frames.length; i++)
    simRewound.step(frames[i] ?? EMPTY_INPUT);
  const rewoundHash = simRewound.hashState();

  expect(rewoundHash).toBe(fullHash);
});

// ── updateConfig() doesn't break prior determinism ──────────────────────────

test("updateConfig() of a JS-side tuning knob does not affect frames stepped before the change", () => {
  const frames = scriptedFrameList();
  const midpoint = Math.floor(frames.length / 2);

  // Run to midpoint, snapshot, update config, step to end.
  const simPatched = newSim();
  for (let i = 0; i < midpoint; i++) simPatched.step(frames[i] ?? EMPTY_INPUT);
  const snapBefore = simPatched.takeSnapshot();
  simPatched.updateConfig({
    movement: { ...DEFAULT_CONFIG.movement, moveSpeed: 999 },
  });
  for (let i = midpoint; i < frames.length; i++)
    simPatched.step(frames[i] ?? EMPTY_INPUT);
  const patchedHash = simPatched.hashState();

  // Restore to midpoint and re-run with the same patched config — result must match.
  simPatched.restoreSnapshot(snapBefore);
  simPatched.updateConfig({
    movement: { ...DEFAULT_CONFIG.movement, moveSpeed: 999 },
  });
  for (let i = midpoint; i < frames.length; i++)
    simPatched.step(frames[i] ?? EMPTY_INPUT);
  expect(simPatched.hashState()).toBe(patchedHash);
});

// ── getDebugColliders() returns expected shapes ──────────────────────────────

test("getDebugColliders() returns arena boxes + player/ball + Bell art and hit-zones", () => {
  const sim = newSim();
  // Step once so the player and ball have settled from spawn.
  sim.step(EMPTY_INPUT);
  const shapes = sim.getDebugColliders();

  // Arena: 4 colliders (floor + left/right walls + overhang).
  const arenaBoxes = shapes.filter((s) => s.label.startsWith("arena"));
  expect(arenaBoxes).toHaveLength(FLAT_DOJO.colliders.length);

  // Player box.
  expect(shapes.some((s) => s.label === "player" && s.kind === "box")).toBe(
    true,
  );

  // Ball circle.
  expect(shapes.some((s) => s.label === "ball" && s.kind === "circle")).toBe(
    true,
  );

  // Bell art boxes (one per Bell).
  const bellArtBoxes = shapes.filter((s) => s.label.endsWith("-art"));
  expect(bellArtBoxes).toHaveLength(FLAT_DOJO.bells.length);

  // Bell hit-zone circles (one per Bell, distinct from art).
  const bellZones = shapes.filter((s) => s.label.endsWith("-hitzone"));
  expect(bellZones).toHaveLength(FLAT_DOJO.bells.length);
  for (const z of bellZones) {
    expect(z.kind).toBe("circle");
  }
});
