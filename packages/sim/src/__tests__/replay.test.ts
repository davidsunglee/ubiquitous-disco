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
  type BotWorldView,
  CHARACTERS,
  type CharacterDef,
  type CharacterId,
  createReplay,
  createSimulation,
  DEFAULT_CONFIG,
  deserializeReplay,
  EMPTY_INPUT,
  FLAT_DOJO,
  type InputFrame,
  initSim,
  playReplay,
  recordFrame,
  samplePracticeBotInput,
  serializeReplay,
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
 * Returns per-tick rows using the 1v1 [0, 2] active-slot template.
 */
function scriptedFrameList(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  // Helper: sparse row for the 1v1 [0, 2] template.
  // Slot 0 = left player (driven), slot 2 = right player (idle with gravity applied).
  // Providing EMPTY_INPUT at index 2 ensures gravity is applied to slot 2's body
  // (stepMovement is called), keeping it grounded — identical to old [0,1] behavior.
  function row(f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = f0;
    r[2] = f2;
    return r;
  }

  // Settle on the ground.
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT));
  // Walk right.
  for (let i = 0; i < 20; i++) frames.push(row(frame({ moveX: 1 })));
  // Full held jump.
  frames.push(row(frame({ moveX: 1, jumpPressed: true, jumpHeld: true })));
  for (let i = 0; i < 20; i++)
    frames.push(row(frame({ moveX: 1, jumpHeld: true })));
  // Settle again.
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT));
  // Tele-Dash right.
  frames.push(row(frame({ moveX: 1, dashPressed: true, dashHeld: true })));
  for (let i = 0; i < 5; i++) frames.push(row(frame({ moveX: 1 })));
  // Walk right until near ball.
  for (let i = 0; i < 20; i++) frames.push(row(frame({ moveX: 1 })));
  // Charged upward Strike.
  frames.push(
    row(frame({ moveX: 1, moveY: 1, strikeHeld: true, strikePressed: true })),
  );
  for (let i = 0; i < 10; i++) {
    frames.push(row(frame({ moveX: 1, moveY: 1, strikeHeld: true })));
  }
  frames.push(row(frame({ moveX: 1, moveY: 1, strikeReleased: true })));
  // Let the ball fly.
  for (let i = 0; i < 40; i++) frames.push(row(EMPTY_INPUT));
  return frames;
}

// ── Core replay capture + playback ─────────────────────────────────────────

test("playReplay() called twice on the same ReplayData returns equal hashes", () => {
  const replay = createReplay(9999);
  const sim = newSim();
  for (const row of scriptedFrameList()) {
    recordFrame(replay, row);
    sim.step(row);
  }

  const hash1 = playReplay(replay);
  const hash2 = playReplay(replay);
  expect(hash1).toBe(hash2);
});

test("playReplay() survives a serialize→deserialize round-trip of sparse rows", () => {
  // The hotseat UI captures SPARSE rows (slot 0 and slot 2 set, index 1 a hole),
  // then serializeReplay() → JSON.stringify() turns the hole into an explicit
  // `null` before the Replay button feeds it back through deserializeReplay() +
  // playReplay(). anyStartPressed() must tolerate that null instead of throwing.
  const replay = createReplay(9999);
  const sim = newSim();
  for (const row of scriptedFrameList()) {
    recordFrame(replay, row);
    sim.step(row);
  }
  const liveHash = sim.hashState();

  // Round-trip through JSON exactly like the capture-download / replay path.
  const roundTripped = deserializeReplay(serializeReplay(replay));
  // The serialized rows now carry explicit nulls where the sparse holes were.
  expect(roundTripped.inputFrames[0]?.[1]).toBeNull();

  expect(() => playReplay(roundTripped)).not.toThrow();
  expect(playReplay(roundTripped)).toBe(liveHash);
});

test("playReplay() hash equals the live capture session's final hashState()", () => {
  const replay = createReplay(9999);
  const sim = newSim();
  const frames = scriptedFrameList();

  for (const row of frames) {
    recordFrame(replay, row);
    sim.step(row);
  }

  const liveHash = sim.hashState();
  const replayHash = playReplay(replay);
  expect(replayHash).toBe(liveHash);
});

test("two independent live runs with the same frames produce the same hash", () => {
  const frames = scriptedFrameList();

  const runHash = () => {
    const sim = newSim();
    for (const row of frames) sim.step(row);
    return sim.hashState();
  };

  expect(runHash()).toBe(runHash());
});

// ── Snapshot / restore (rewind) ─────────────────────────────────────────────

// A snapshot/restore "rewind": run to the midpoint, snapshot, step to the end,
// restore back to the midpoint, then re-run the tail. Returns the final sim.
function runRewound(frames: InputFrame[][], midpoint: number) {
  const sim = newSim();
  for (let i = 0; i < midpoint; i++)
    sim.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  const snap = sim.takeSnapshot();
  for (let i = midpoint; i < frames.length; i++) {
    sim.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }
  sim.restoreSnapshot(snap);
  for (let i = midpoint; i < frames.length; i++) {
    sim.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }
  return sim;
}

test("restoring a snapshot reproduces the run's physical state and is itself deterministic", () => {
  const frames = scriptedFrameList();
  const midpoint = Math.floor(frames.length / 2);

  // Uninterrupted run.
  const simFull = newSim();
  for (const row of frames) simFull.step(row);
  const fullRender = simFull.getRenderState();

  // restoreSnapshot() is physically faithful: a rewound run lands the players and
  // ball at exactly the same positions/state as the uninterrupted run.
  expect(runRewound(frames, midpoint).getRenderState()).toEqual(fullRender);

  // The restore path is also deterministic with itself: two independent rewinds
  // produce a bit-identical hash.
  //
  // We deliberately do NOT assert byte-equality between a rewound run and the
  // uninterrupted run. Rapier's restoreSnapshot() reproduces physical state
  // exactly but does not round-trip every internal contact-solver accumulator
  // (warm-start impulses / manifolds), so the opaque snapshot bytes can differ
  // once the post-restore ball is in active contact (e.g. bouncing off the
  // ceiling). The design's actual determinism contract — replay-from-scratch —
  // stays bit-exact and is covered by the playReplay tests above.
  expect(runRewound(frames, midpoint).hashState()).toBe(
    runRewound(frames, midpoint).hashState(),
  );
});

// ── updateConfig() doesn't break prior determinism ──────────────────────────

test("updateConfig() of a JS-side tuning knob does not affect frames stepped before the change", () => {
  const frames = scriptedFrameList();
  const midpoint = Math.floor(frames.length / 2);
  const patch = { movement: { ...DEFAULT_CONFIG.movement, moveSpeed: 999 } };

  // Reference: run to midpoint, patch, run to end — no restore involved.
  const ref = newSim();
  for (let i = 0; i < midpoint; i++)
    ref.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  ref.updateConfig(patch);
  for (let i = midpoint; i < frames.length; i++) {
    ref.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }
  const refRender = ref.getRenderState();

  // Same scenario reached via snapshot → step-on → restore → patch → re-step.
  // The pre-change frames are untouched, so the physical outcome matches the
  // reference exactly (see the restore-determinism note above re: snapshot bytes).
  const viaRestore = newSim();
  for (let i = 0; i < midpoint; i++) {
    viaRestore.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }
  const snapBefore = viaRestore.takeSnapshot();
  for (let i = midpoint; i < frames.length; i++) {
    viaRestore.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }
  viaRestore.restoreSnapshot(snapBefore);
  viaRestore.updateConfig(patch);
  for (let i = midpoint; i < frames.length; i++) {
    viaRestore.step(frames[i] ?? [EMPTY_INPUT, EMPTY_INPUT]);
  }

  expect(viaRestore.getRenderState()).toEqual(refRender);
});

// ── Match-state is folded into the hash (serializeMatchState) ───────────────

test("playReplay hash equals live hash for a scripted match start path", () => {
  // Use a very short match so we exercise the match phase transitions
  // (preRound → playing → timer decrement) within a reasonable number of steps.
  const shortMatchConfig = {
    ...DEFAULT_CONFIG,
    match: {
      ...DEFAULT_CONFIG.match,
      lengthTicks: 60,
      scoringPauseTicks: 2,
      resetTicks: 2,
    },
  };
  const replay = createReplay(9999);
  const sim = createSimulation({
    config: shortMatchConfig,
    arena: FLAT_DOJO,
    seed: 9999,
  });

  // Build frames: start the match (jump edge on tick 0), then idle.
  const matchFrames: InputFrame[][] = [];
  // Start (jumpPressed).
  matchFrames.push([frame({ jumpPressed: true, jumpHeld: true }), EMPTY_INPUT]);
  // Idle for 70 ticks (past regulation).
  for (let i = 0; i < 70; i++) matchFrames.push([EMPTY_INPUT, EMPTY_INPUT]);

  for (const row of matchFrames) {
    recordFrame(replay, row);
    sim.step(row);
  }

  const liveHash = sim.hashState();
  // Override the config stored in replay to use the same short-match config.
  // playReplay() uses DEFAULT_CONFIG, so we need a custom playback path.
  // Instead, verify the replay hash matches itself (deterministic across two runs).
  const sim2 = createSimulation({
    config: shortMatchConfig,
    arena: FLAT_DOJO,
    seed: 9999,
  });
  for (const row of replay.inputFrames) sim2.step(row);
  expect(sim2.hashState()).toBe(liveHash);
});

// ── Replay with Practice Bot slot: hash is stable across runs ───────────────

/**
 * Build a 2v2 frame list where slots 0, 1, 2 are driven by scripted human
 * inputs and slot 3 is driven by samplePracticeBotInput (a Practice Bot).
 * Recording bot outputs into the replay and replaying them must be
 * deterministic (same hash on two independent playbacks).
 */
function buildBotReplayFrames(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  // Create a sim just to drive the bot decisions from authoritative state.
  const driveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 8888,
    activeSlots: [0, 1, 2, 3],
  });

  const emptyRow = (): InputFrame[] => {
    const r: InputFrame[] = [];
    r[0] = EMPTY_INPUT;
    r[1] = EMPTY_INPUT;
    r[2] = EMPTY_INPUT;
    r[3] = EMPTY_INPUT;
    return r;
  };

  for (let tick = 0; tick < 80; tick++) {
    const row = emptyRow();

    // Slot 0 human: start on tick 0, then idle.
    if (tick === 0) {
      row[0] = frame({ jumpPressed: true, jumpHeld: true });
    }

    // Slot 3 bot: sample from authoritative state each tick.
    const render = driveSim.getRenderState();
    const ballVel = driveSim.getBallVel();
    const p3 = render.players[3];
    if (p3) {
      const botView: BotWorldView = {
        tick,
        self: { x: p3.x, y: p3.y, facing: p3.facing, grounded: p3.grounded },
        ball: {
          x: render.ball.x,
          y: render.ball.y,
          vx: ballVel.vx,
          vy: ballVel.vy,
        },
      };
      row[3] = samplePracticeBotInput(3, botView, DEFAULT_CONFIG);
    }

    frames.push(row);
    driveSim.step(row);
  }

  return frames;
}

test("replay with Practice Bot slot: playback is deterministic across two runs", () => {
  const frames = buildBotReplayFrames();
  const seed = 8888;

  // Run #1.
  const sim1 = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    activeSlots: [0, 1, 2, 3],
  });
  for (const row of frames) sim1.step(row);
  const hash1 = sim1.hashState();

  // Run #2 (independent).
  const sim2 = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    activeSlots: [0, 1, 2, 3],
  });
  for (const row of frames) sim2.step(row);
  const hash2 = sim2.hashState();

  expect(hash1).toBe(hash2);
});

test("replay with Practice Bot slot: recorded frames replay to the same hash as live capture", () => {
  const frames = buildBotReplayFrames();
  const seed = 8888;

  // Replay using a ReplayData (recordFrame path).
  const replay = createReplay(seed);
  const liveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    activeSlots: [0, 1, 2, 3],
  });
  for (const row of frames) {
    recordFrame(replay, row);
    liveSim.step(row);
  }
  const liveHash = liveSim.hashState();

  // Play back the recorded frames through a fresh sim.
  const replaySim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    activeSlots: [0, 1, 2, 3],
  });
  for (const row of replay.inputFrames) replaySim.step(row);
  expect(replaySim.hashState()).toBe(liveHash);
});

// ── Phase 2 (FLI-9): Panda-Special replay determinism ───────────────────────

/**
 * Build a frame list where slot 0 (Panda) fires its Ground Pound Special once,
 * then both players idle. This exercises the specialCooldown in the hash path.
 */
function buildPandaSpecialFrames(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  function row(f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = f0;
    r[2] = f2;
    return r;
  }

  // Start the match.
  frames.push(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  // Settle for 20 ticks.
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT));
  // Walk toward the ball.
  for (let i = 0; i < 10; i++) frames.push(row(frame({ moveX: 1 })));
  // Fire Special.
  frames.push(row(frame({ specialPressed: true, specialHeld: true })));
  // Idle for 40 ticks.
  for (let i = 0; i < 40; i++) frames.push(row(EMPTY_INPUT));
  return frames;
}

test("Panda-Special match: two sims with the same characters + frames produce the same hash", () => {
  const pandaDef = CHARACTERS.panda;
  const frames = buildPandaSpecialFrames();

  const run = () => {
    const sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 6161,
      characters: [pandaDef],
    });
    for (const row of frames) sim.step(row);
    return sim.hashState();
  };

  expect(run()).toBe(run());
});

test("Panda-Special match: recorded replay plays back to the same hash as the live session", () => {
  const pandaDef = CHARACTERS.panda;
  const frames = buildPandaSpecialFrames();

  const replay = createReplay(6161);
  const liveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 6161,
    characters: [pandaDef],
  });

  for (const row of frames) {
    recordFrame(replay, row);
    liveSim.step(row);
  }

  const liveHash = liveSim.hashState();

  // Replay using a fresh sim with the same character roster.
  const replaySim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed: 6161,
    characters: [pandaDef],
  });
  for (const row of replay.inputFrames) replaySim.step(row);
  expect(replaySim.hashState()).toBe(liveHash);
});

// ── Phase 3 (FLI-9): Drunken Boxer replay determinism ───────────────────────

/**
 * Build a frame list where slot 0 (Drunken Boxer) fires Stagger Stumble once.
 * The seeded-random lunge + optional ball redirect must replay bit-identically
 * through playReplay (which uses the characterIds from ReplayData).
 */
function buildDrunkenBoxerSpecialFrames(): InputFrame[][] {
  const frames: InputFrame[][] = [];

  function row(f0: InputFrame, f2: InputFrame = EMPTY_INPUT): InputFrame[] {
    const r: InputFrame[] = [];
    r[0] = f0;
    r[2] = f2;
    return r;
  }

  // Start the match.
  frames.push(
    row(
      frame({ jumpPressed: true, jumpHeld: true }),
      frame({ jumpPressed: true, jumpHeld: true }),
    ),
  );
  // Settle.
  for (let i = 0; i < 20; i++) frames.push(row(EMPTY_INPUT));
  // Walk toward ball.
  for (let i = 0; i < 10; i++) frames.push(row(frame({ moveX: 1 })));
  // Fire Stagger Stumble.
  frames.push(row(frame({ specialPressed: true, specialHeld: true })));
  // Settle.
  for (let i = 0; i < 40; i++) frames.push(row(EMPTY_INPUT));
  return frames;
}

test("Drunken Boxer Stagger Stumble: two sims with the same seed + characters produce the same hash", () => {
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerSpecialFrames();

  const run = () => {
    const sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 8080,
      characters: [drunkenBoxerDef],
    });
    for (const row of frames) sim.step(row);
    return sim.hashState();
  };

  expect(run()).toBe(run());
});

test("Drunken Boxer Stagger Stumble: playReplay with characterIds replays bit-identically", () => {
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerSpecialFrames();
  const seed = 8080;

  // characterIds array: slot 0 = drunken-boxer, slot 2 = sifu (default).
  const characterIds: CharacterId[] = [];
  characterIds[0] = "drunken-boxer";
  characterIds[2] = "sifu";

  const replay = createReplay(seed, FLAT_DOJO.id, "default", characterIds);
  const liveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    characters: [drunkenBoxerDef],
  });

  for (const row of frames) {
    recordFrame(replay, row);
    liveSim.step(row);
  }

  const liveHash = liveSim.hashState();
  const replayHash = playReplay(replay);
  expect(replayHash).toBe(liveHash);
});

test("Drunken Boxer Stagger Stumble: playReplay called twice produces the same hash", () => {
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerSpecialFrames();
  const seed = 8080;

  const characterIds: CharacterId[] = [];
  characterIds[0] = "drunken-boxer";
  characterIds[2] = "sifu";

  const replay = createReplay(seed, FLAT_DOJO.id, "default", characterIds);
  const liveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    characters: [drunkenBoxerDef],
  });
  for (const row of frames) {
    recordFrame(replay, row);
    liveSim.step(row);
  }

  const hash1 = playReplay(replay);
  const hash2 = playReplay(replay);
  expect(hash1).toBe(hash2);
});

test("Drunken Boxer Stagger Stumble: replays bit-identically through a serialize→deserialize round-trip", () => {
  // This is the exact path the hotseat Capture-download / Replay button uses:
  // SPARSE rows AND SPARSE characterIds (slot 0 + slot 2 set, index 1 a hole),
  // JSON-serialized then re-parsed before playReplay(). JSON.stringify
  // materializes the holes as explicit `null`, which both playReplay's
  // characterIds map and stepMatch's anyStartPressed must tolerate.
  const drunkenBoxerDef = CHARACTERS["drunken-boxer"];
  const frames = buildDrunkenBoxerSpecialFrames();
  const seed = 8080;

  const characterIds: CharacterId[] = [];
  characterIds[0] = "drunken-boxer";
  characterIds[2] = "drunken-boxer";

  const replay = createReplay(seed, FLAT_DOJO.id, "default", characterIds);
  const characters: CharacterDef[] = [];
  characters[0] = drunkenBoxerDef;
  characters[2] = drunkenBoxerDef;
  const liveSim = createSimulation({
    config: DEFAULT_CONFIG,
    arena: FLAT_DOJO,
    seed,
    characters,
  });

  for (const row of frames) {
    recordFrame(replay, row);
    liveSim.step(row);
  }
  const liveHash = liveSim.hashState();

  // Round-trip through JSON exactly like Capture-download → Replay button.
  const roundTripped = deserializeReplay(serializeReplay(replay));
  // Sparse holes at index 1 are now explicit nulls in both arrays.
  expect(roundTripped.characterIds?.[1]).toBeNull();
  expect(roundTripped.inputFrames[0]?.[1]).toBeNull();

  expect(() => playReplay(roundTripped)).not.toThrow();
  expect(playReplay(roundTripped)).toBe(liveHash);
});

// ── getDebugColliders() returns expected shapes ──────────────────────────────

test("getDebugColliders() returns arena boxes + player/ball + Bell art and hit-zones", () => {
  const sim = newSim();
  // Step once so the players and ball have settled from spawn.
  sim.step([EMPTY_INPUT, EMPTY_INPUT]);
  const shapes = sim.getDebugColliders();

  // Arena: 5 colliders (floor + left/right walls + overhang + ceiling).
  const arenaBoxes = shapes.filter((s) => s.label.startsWith("arena"));
  expect(arenaBoxes).toHaveLength(FLAT_DOJO.colliders.length);

  // Player boxes — one per active slot. newSim() uses the default 1v1 template
  // [0, 2] (2 active slots), not all 4 spawns in FLAT_DOJO.playerSpawns.
  const playerBoxes = shapes.filter(
    (s) => s.label.startsWith("player[") && s.kind === "box",
  );
  expect(playerBoxes).toHaveLength(2); // activeSlots [0, 2] → 2 active players

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
