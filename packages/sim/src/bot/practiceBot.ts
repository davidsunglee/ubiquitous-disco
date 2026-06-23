/**
 * Server-side deterministic Practice Bot controller.
 *
 * Produces an InputFrame from a read-only view of authoritative state for one
 * slot. Behaviours:
 *  - Chase the ball.
 *  - Strike toward the opposing Bell when in reach and facing the right direction.
 *  - Jump for a high ball.
 *  - Tele-Dash to close distance (cadence-gated so the bot doesn't spam it).
 *  - Retreat toward own side when the ball is heading dangerously toward the own Bell.
 *
 * Determinism contract: same (slotId, view, config) → identical InputFrame.
 * The bot reads only its own position/state and the ball — no shared mutable state.
 */

import type { ResolvedStats } from "../character";
import type { SimConfig } from "../config";
import { EMPTY_INPUT, type InputFrame } from "../input";
import type { PlayerSlotId } from "../team";
import { teamForPlayerSlot } from "../team";

/**
 * Read-only authoritative view the bot decides from.
 * The server builds this each tick before calling samplePracticeBotInput.
 */
export interface BotWorldView {
  tick: number;
  self: { x: number; y: number; facing: 1 | -1; grounded: boolean };
  ball: { x: number; y: number; vx: number; vy: number };
  /**
   * Active-arena geometry the bot needs (replaces FLAT_DOJO hardcodes).
   * Optional for backward compatibility with legacy test fixtures; the server
   * always populates this. Defaults to FLAT_DOJO geometry when absent.
   */
  arena?: { leftBellX: number; rightBellX: number; wallInnerX: number };
}

/**
 * Produce one InputFrame for the given slot from the authoritative world view.
 *
 * Pure function — no side effects. Same inputs always produce the same output
 * (determinism contract for replay and bot-routing tests).
 */
export function samplePracticeBotInput(
  slotId: PlayerSlotId,
  view: BotWorldView,
  config: SimConfig,
  stats: Pick<ResolvedStats, "strikeReach" | "dashDistance"> = {
    strikeReach: config.strike.reach,
    dashDistance: config.dash.distance,
  },
): InputFrame {
  const team = teamForPlayerSlot(slotId);

  // Team 0 = left side (defends left Bell, attacks right Bell).
  // Team 1 = right side (defends right Bell, attacks left Bell).
  // Fall back to FLAT_DOJO geometry when arena is absent (legacy callers).
  const arenaGeom = view.arena ?? {
    leftBellX: -9,
    rightBellX: 9,
    wallInnerX: 11.5,
  };
  const ownBellX = team === 0 ? arenaGeom.leftBellX : arenaGeom.rightBellX;
  const targetBellX = team === 0 ? arenaGeom.rightBellX : arenaGeom.leftBellX;

  const { self, ball, tick } = view;
  const dxBall = ball.x - self.x;
  const distBall = Math.hypot(dxBall, ball.y - self.y);

  // ── Wall / corner awareness ──
  // The side walls' inner faces are derived from the active arena. Treat the bot
  // as "cornered" once it is pressed within WALL_MARGIN of a wall AND the ball is
  // pulling it further into that wall. "Away from the nearest wall" always points
  // back toward open play and the target Bell.
  const WALL_INNER_X = arenaGeom.wallInnerX;
  const WALL_MARGIN = 1.5;
  const nearLeftWall = self.x <= -(WALL_INNER_X - WALL_MARGIN);
  const nearRightWall = self.x >= WALL_INNER_X - WALL_MARGIN;
  const awayFromWall = nearLeftWall ? 1 : nearRightWall ? -1 : 0;
  const cornered =
    (nearLeftWall && dxBall <= 0) || (nearRightWall && dxBall >= 0);

  // Ball is "dangerous" when it is heading quickly toward the own Bell from the
  // wrong side — i.e. ball velocity is moving it toward ownBellX and it is
  // already on the own side of centre.
  const ballTowardOwnBell =
    team === 0
      ? ball.vx < -3 && ball.x < 0 // moving left, already left of centre
      : ball.vx > 3 && ball.x > 0; // moving right, already right of centre
  const ballDangerous = ballTowardOwnBell;

  // Primary movement: break out of a corner first, then retreat when dangerous,
  // otherwise chase the ball.
  let moveX: number;
  if (cornered) {
    // Stop grinding into the wall; head back toward open play (and the target Bell).
    moveX = awayFromWall;
  } else if (ballDangerous) {
    moveX = Math.sign(ownBellX - self.x);
  } else {
    // Chase ball horizontally; if ball is exactly at x, default to attacking direction.
    moveX = dxBall !== 0 ? Math.sign(dxBall) : team === 0 ? 1 : -1;
  }

  // Strike when the ball is in reach AND the bot is either facing the target Bell
  // or clearing the ball out of a corner (where moveX already points to open play).
  const inReach = distBall <= stats.strikeReach;
  const facingTargetBell =
    Math.sign(targetBellX - self.x) ===
    Math.sign(moveX || (team === 0 ? 1 : -1));
  const wantStrike =
    inReach && (facingTargetBell || cornered) && !ballDangerous;

  // Jump for a high ball (ball is above us and we're grounded).
  const wantJump = ball.y - self.y > 1.5 && self.grounded && !wantStrike;

  // Tele-Dash to close distance when far from the ball (cadence-gated to avoid spam).
  // Only dash when not in reach and the ball is far enough to warrant it.
  const wantDash =
    !inReach &&
    distBall > stats.dashDistance &&
    !ballDangerous &&
    tick % 18 === 0 &&
    self.grounded;

  if (wantStrike) {
    return {
      ...EMPTY_INPUT,
      moveX,
      moveY: 1, // aim upward toward bell
      strikeHeld: true,
      strikePressed: true,
      strikeReleased: true, // tap strike: press+release same tick → min-charge
    };
  }

  if (wantJump) {
    return {
      ...EMPTY_INPUT,
      moveX,
      jumpHeld: true,
      jumpPressed: true,
    };
  }

  if (wantDash) {
    return {
      ...EMPTY_INPUT,
      moveX,
      dashHeld: true,
      dashPressed: true,
    };
  }

  return {
    ...EMPTY_INPUT,
    moveX,
  };
}
