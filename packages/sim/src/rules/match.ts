/**
 * Match lifecycle — state, transitions, serialization.
 *
 * MatchState owns the authoritative phase, per-team scores, regulation timer,
 * and pause/reset counters. stepMatch() runs LAST each tick (after gameplay
 * rules and any scoring side-effects applied by the sim) and advances the
 * match lifecycle machine.
 *
 * Responsibility split:
 *  - Scoring side-effects (score increment, pauseTicks set, bellPause/goldenGoal
 *    finish) live in simulation.ts (it owns the bell-ring pass and knows the
 *    arena's defends mapping).
 *  - Timer countdown, pause/reset countdowns, preRound/complete start edges,
 *    and regulation-end golden-goal-vs-finish live here in stepMatch().
 *
 * This keeps the two sides from double-handling: the sim sets pauseTicks and
 * transitions to bellPause; stepMatch drives bellPause → resetting → resume.
 */

import type { SimConfig } from "../config";
import type { InputFrame } from "../input";

// ── Phase type ────────────────────────────────────────────────────────────────

export type MatchPhase =
  | "preRound"
  | "playing"
  | "bellPause"
  | "resetting"
  | "goldenGoal"
  | "complete";

// ── Match state ───────────────────────────────────────────────────────────────

export interface MatchState {
  phase: MatchPhase;
  /**
   * Per-team score; index == TeamId (0 or 1). Always length 2 for official
   * modes. Independent of the number of occupied Player Slots.
   */
  scores: number[];
  /** Regulation ticks remaining (counts down while in "playing"). */
  timer: number;
  /** >0 while in "bellPause"; set by the sim when a Bell rings. */
  pauseTicks: number;
  /** >0 while in "resetting"; set by stepMatch when entering resetting. */
  resetTicks: number;
  /** -1 = tie/none; set when phase becomes "complete". */
  winner: number;
  /** True once the regulation timer has expired (used to decide post-resetting destination). */
  timerExpired: boolean;
}

export function createMatchState(config: SimConfig, teamCount = 2): MatchState {
  return {
    phase: "preRound",
    scores: Array(teamCount).fill(0) as number[],
    timer: config.match.lengthTicks,
    pauseTicks: 0,
    resetTicks: 0,
    winner: -1,
    timerExpired: false,
  };
}

// ── Phase guards ──────────────────────────────────────────────────────────────

/** True only in phases where gameplay rules (movement/strike/ball/bellRing) run. */
export function isLivePhase(m: MatchState): boolean {
  return m.phase === "playing" || m.phase === "goldenGoal";
}

// ── Event sink (minimal interface to avoid circular deps) ─────────────────────

export interface MatchEventSink {
  push(event: { type: string; [key: string]: unknown }): void;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function transition(
  match: MatchState,
  phase: MatchPhase,
  events: MatchEventSink,
  tick: number,
): void {
  match.phase = phase;
  events.push({ type: "matchPhase", phase, tick });
}

function finish(match: MatchState, events: MatchEventSink, tick: number): void {
  const top = Math.max(...match.scores);
  const leaders = match.scores.filter((s) => s === top).length;
  match.winner = leaders > 1 ? -1 : match.scores.indexOf(top);
  transition(match, "complete", events, tick);
  events.push({
    type: "matchEnd",
    winner: match.winner === -1 ? "tie" : match.winner,
    scores: [...match.scores],
    tick,
  });
}

/** Decide what comes after a resetting phase ends: resume play, enter golden
 *  goal, or finish the match. Called by stepMatch when resetTicks runs out. */
function afterReset(
  match: MatchState,
  events: MatchEventSink,
  config: SimConfig,
  tick: number,
): void {
  if (!match.timerExpired) {
    // Timer still running: resume normal play.
    transition(match, "playing", events, tick);
    return;
  }
  // Timer already expired: decide outcome now.
  const top = Math.max(...match.scores);
  const leaders = match.scores.filter((s) => s === top).length;
  if (leaders > 1 && config.match.goldenGoal) {
    transition(match, "goldenGoal", events, tick);
  } else {
    finish(match, events, tick);
  }
}

/** A jump-button edge from ANY slot acts as Start (preRound) / Rematch (complete). */
function anyStartPressed(inputs: InputFrame[]): boolean {
  return inputs.some((f) => f.jumpPressed);
}

// ── Public step function ──────────────────────────────────────────────────────

/**
 * Advance the match one tick. Runs LAST each tick (after gameplay rules and
 * any scoring side-effects applied by simulation.ts). The sim sets `pauseTicks`
 * and transitions to "bellPause" when a Bell rings; stepMatch then drives
 * bellPause → resetting → resume.
 *
 * @param match  The MatchState to mutate in place.
 * @param inputs One InputFrame per slot (for start/rematch edge detection).
 * @param events Event sink — receives matchPhase and matchEnd events.
 * @param config The live SimConfig.
 * @param tick   The current tick counter (for event timestamps).
 */
export function stepMatch(
  match: MatchState,
  inputs: InputFrame[],
  events: MatchEventSink,
  config: SimConfig,
  tick: number,
): void {
  switch (match.phase) {
    case "preRound":
      if (anyStartPressed(inputs)) {
        transition(match, "playing", events, tick);
      }
      break;

    case "playing":
      // If the sim just set pauseTicks (bell rang this tick), defer timer
      // decrement — the bellPause phase will handle countdowns.
      if (match.pauseTicks > 0) break;
      match.timer -= 1;
      if (match.timer <= 0) {
        match.timerExpired = true;
        // Regulation over: decide winner or enter Golden Goal.
        const top = Math.max(...match.scores);
        const leaders = match.scores.filter((s) => s === top).length;
        if (leaders > 1 && config.match.goldenGoal) {
          transition(match, "goldenGoal", events, tick);
        } else {
          finish(match, events, tick);
        }
      }
      break;

    case "bellPause":
      match.pauseTicks -= 1;
      if (match.pauseTicks <= 0) {
        match.pauseTicks = 0;
        match.resetTicks = config.match.resetTicks;
        transition(match, "resetting", events, tick);
      }
      break;

    case "resetting":
      match.resetTicks -= 1;
      if (match.resetTicks <= 0) {
        match.resetTicks = 0;
        afterReset(match, events, config, tick);
      }
      break;

    case "goldenGoal":
      // Sudden death: no timer; a ring (handled in simulation.ts) finishes the match.
      break;

    case "complete":
      if (anyStartPressed(inputs)) {
        // Rematch: reset everything and go straight to playing.
        const teamCount = match.scores.length;
        const fresh = createMatchState(config, teamCount);
        Object.assign(match, fresh);
        transition(match, "playing", events, tick);
      }
      break;
  }
}

// ── Serialization ─────────────────────────────────────────────────────────────

// Phase index map for stable byte encoding.
const PHASE_INDEX: Record<MatchPhase, number> = {
  preRound: 0,
  playing: 1,
  bellPause: 2,
  resetting: 3,
  goldenGoal: 4,
  complete: 5,
};

/**
 * Serialize MatchState to a fixed-layout byte buffer for inclusion in the
 * composite hash. Layout (byte-stable):
 *
 *   phase       u8   (enum index)
 *   timer       i32
 *   pauseTicks  i32
 *   resetTicks  i32
 *   winner      i8
 *   timerExpired u8
 *   numTeams    u8
 *   scores[i]   i32  × numTeams
 *
 * Total size: 1 + 4 + 4 + 4 + 1 + 1 + 1 + 4*numTeams bytes.
 */
export function serializeMatchState(m: MatchState): Uint8Array {
  const numTeams = m.scores.length;
  // 1 (phase) + 4 (timer) + 4 (pauseTicks) + 4 (resetTicks) + 1 (winner) + 1 (timerExpired) + 1 (numTeams) + 4*numTeams (scores)
  const byteLen = 1 + 4 + 4 + 4 + 1 + 1 + 1 + 4 * numTeams;
  const buf = new ArrayBuffer(byteLen);
  const view = new DataView(buf);
  let o = 0;
  view.setUint8(o, PHASE_INDEX[m.phase]);
  o += 1;
  view.setInt32(o, m.timer);
  o += 4;
  view.setInt32(o, m.pauseTicks);
  o += 4;
  view.setInt32(o, m.resetTicks);
  o += 4;
  view.setInt8(o, m.winner);
  o += 1;
  view.setUint8(o, m.timerExpired ? 1 : 0);
  o += 1;
  view.setUint8(o, numTeams);
  o += 1;
  for (let i = 0; i < numTeams; i++) {
    view.setInt32(o, m.scores[i] ?? 0);
    o += 4;
  }
  return new Uint8Array(buf);
}
