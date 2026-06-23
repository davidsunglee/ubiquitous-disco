/**
 * GroupCamera — dynamic framing camera that keeps the player, ball, and both
 * Bells visible in the viewport at all times.
 *
 * Phase 5 (FLI-9): adaptive camera with zoom floor so characters remain
 * readable on large arenas, ball-centric focal point when the zoom floor
 * clamps, and team-coloured edge arrows for off-screen player subjects.
 *
 * Each frame:
 *  1. Compute a world-unit bounding box across all four subjects.
 *  2. Add a fixed margin in world units.
 *  3. Derive zoom as min(cam.width / bbox.w, cam.height / bbox.h), clamped to
 *     [minZoom, MAX_ZOOM] where minZoom is derived from MIN_CHAR_PX.
 *  4. When the fit-zoom < minZoom (zoom is clamped): centre on a ball-centric
 *     focal point instead of the full centroid, and draw edge arrows for any
 *     player subject outside the visible viewport.
 *  5. Lerp the running zoom toward the target (smooth).
 *  6. Call cam.centerOn(centroidX, centroidY) so the group stays centred.
 *
 * All subject positions must be in **screen pixels** (already converted via
 * worldToScreen helpers) because Phaser's camera operates in the same pixel
 * space as game objects.
 */

import Phaser from "phaser";
import {
  type ArrowSubject,
  computeOffscreenArrows,
  DEFAULT_ARROW_OPTS,
} from "./arrowLayout";
import { PX_PER_UNIT, toScreenX, toScreenY } from "./worldToScreen";

// ── Config ────────────────────────────────────────────────────────────────────

/** Minimum world-unit padding around the bounding box on each side. */
const MARGIN_WU = 2.0;
/** Margin in pixels (derived from world-unit margin). */
const MARGIN_PX = MARGIN_WU * PX_PER_UNIT;

/**
 * Adaptive zoom floor.
 * MIN_CHAR_PX: minimum on-screen height for a character (pixels).
 * CHAR_WORLD_HEIGHT: character height in world units (2 * player.halfH = 1.6).
 * minZoom ≈ 40 / (1.6 * 48) ≈ 0.52 — keeps characters readable on large arenas.
 */
const MIN_CHAR_PX = 40;
const CHAR_WORLD_HEIGHT = 1.6; // 2 * config.player.halfH
export const minZoom = MIN_CHAR_PX / (CHAR_WORLD_HEIGHT * PX_PER_UNIT); // ≈ 0.52

/** Maximum zoom (prevents zooming in too close). */
const MAX_ZOOM = 1.8;

/** Smoothing factor [0,1): higher = snappier, lower = smoother. */
const ZOOM_LERP = 0.06;
/** Positional smoothing: camera centroid approaches target each frame. */
const PAN_LERP = 0.08;

/** Arrow triangle half-height (pixels) — bigger so it reads at the edge. */
const ARROW_HALF = 18;
/** Arrow triangle length from base to tip (pixels). */
const ARROW_LEN = 30;

// Team colours matching the rest of the HUD/VFX palette.
const TEAM_COLORS: Record<number, number> = {
  0: 0x4488ff,
  1: 0xff4444,
};

// ── Types ────────────────────────────────────────────────────────────────────

/** A subject position in screen (pixel) coordinates. */
export interface GroupSubject {
  screenX: number;
  screenY: number;
  /** True if this subject is a player (receives off-screen arrows). Ball = false. */
  isPlayer?: boolean;
  /** Team index (0 or 1) for coloring the arrow. Required when isPlayer=true. */
  team?: number;
  /** Player slot id (0..3) — used for the per-team arrow number. */
  slot?: number;
}

// ── GroupCamera ───────────────────────────────────────────────────────────────

export class GroupCamera {
  private currentZoom: number;
  private currentCx: number;
  private currentCy: number;
  private arrowGfx: Phaser.GameObjects.Graphics;
  /** Reused number labels (max one per player → 4). */
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(private readonly cam: Phaser.Cameras.Scene2D.Camera) {
    this.currentZoom = cam.zoom;
    this.currentCx = cam.width / 2;
    this.currentCy = cam.height / 2;
    // Arrow graphics object — rendered in fixed/UI space (not affected by camera
    // scroll/zoom), so we use a separate Graphics instance that we position in
    // screen coordinates each frame.
    this.arrowGfx = cam.scene.add.graphics();
    // Ignore camera transform so arrows always appear at viewport edges.
    this.arrowGfx.setScrollFactor(0);
    this.arrowGfx.setDepth(100);
    // Pre-create up to four number labels (one per player slot).
    for (let i = 0; i < 4; i++) {
      const label = cam.scene.add.text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "22px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
      });
      label.setOrigin(0.5, 0.5);
      label.setScrollFactor(0);
      label.setDepth(101);
      label.setVisible(false);
      this.labels.push(label);
    }
  }

  /**
   * Call once per render frame (in GameScene.update, *after* collectInputFrame
   * but before drawing) with the screen-pixel positions of all subjects.
   *
   * @param subjects - All subjects including players and ball.
   * @param focalScreenX - Optional ball/focal-point X (screen px). When provided
   *   and zoom is clamped, camera centres here rather than the full centroid.
   * @param focalScreenY - Optional ball/focal-point Y (screen px).
   */
  update(
    subjects: GroupSubject[],
    focalScreenX?: number,
    focalScreenY?: number,
  ): void {
    this.arrowGfx.clear();
    for (const label of this.labels) label.setVisible(false);
    if (subjects.length === 0) return;

    // 1. Compute bounding box. The guard above guarantees subjects[0] exists.
    const first = subjects[0] ?? { screenX: 0, screenY: 0 };
    let minX = first.screenX;
    let maxX = minX;
    let minY = first.screenY;
    let maxY = minY;
    for (const s of subjects) {
      if (s.screenX < minX) minX = s.screenX;
      if (s.screenX > maxX) maxX = s.screenX;
      if (s.screenY < minY) minY = s.screenY;
      if (s.screenY > maxY) maxY = s.screenY;
    }

    // 2. Add margin.
    minX -= MARGIN_PX;
    maxX += MARGIN_PX;
    minY -= MARGIN_PX;
    maxY += MARGIN_PX;

    const bboxW = maxX - minX;
    const bboxH = maxY - minY;

    // 3. Derive target zoom (clamped to [minZoom, MAX_ZOOM]).
    const fitZoom = Math.min(this.cam.width / bboxW, this.cam.height / bboxH);
    const zoomClamped = fitZoom < minZoom;
    const targetZoom = Phaser.Math.Clamp(fitZoom, minZoom, MAX_ZOOM);

    // 4. Smooth zoom.
    this.currentZoom += (targetZoom - this.currentZoom) * ZOOM_LERP;
    this.cam.setZoom(this.currentZoom);

    // 5. Determine target pan centroid.
    //    When zoom is clamped: use the ball/focal point if available,
    //    otherwise fall back to the full centroid.
    let targetCx: number;
    let targetCy: number;
    if (
      zoomClamped &&
      focalScreenX !== undefined &&
      focalScreenY !== undefined
    ) {
      targetCx = focalScreenX;
      targetCy = focalScreenY;
    } else {
      targetCx = (minX + maxX) / 2;
      targetCy = (minY + maxY) / 2;
    }

    // 6. Smooth pan toward the target centroid.
    this.currentCx += (targetCx - this.currentCx) * PAN_LERP;
    this.currentCy += (targetCy - this.currentCy) * PAN_LERP;

    this.cam.centerOn(this.currentCx, this.currentCy);

    // 7. Draw off-screen arrows for player subjects when zoom is clamped.
    if (zoomClamped) {
      this.drawOffScreenArrows(subjects);
    }
  }

  /**
   * Draw team-colored edge arrows (with per-team player numbers) for player
   * subjects outside the current viewport. The ball never gets an arrow.
   * Arrows pin to the viewport edge and stack vertically when several players
   * are off the same side. The ball never gets an arrow.
   */
  private drawOffScreenArrows(subjects: GroupSubject[]): void {
    const { width, height } = this.cam;
    const scrollX = this.cam.scrollX;
    const scrollY = this.cam.scrollY;
    const zoom = this.currentZoom;

    // Project the player subjects into viewport space for the layout pass.
    const players: ArrowSubject[] = [];
    for (const s of subjects) {
      if (!s.isPlayer || s.slot === undefined) continue;
      players.push({
        slot: s.slot,
        team: s.team ?? 0,
        vx: (s.screenX - scrollX) * zoom,
        vy: (s.screenY - scrollY) * zoom,
      });
    }

    const arrows = computeOffscreenArrows(
      players,
      { width, height },
      DEFAULT_ARROW_OPTS,
    );

    let labelIdx = 0;
    for (const a of arrows) {
      const color = TEAM_COLORS[a.team] ?? 0xffffff;
      this.arrowGfx.fillStyle(color, 0.9);

      // Triangle tip pins to the edge; the base points inward.
      const dir = a.side === "left" ? -1 : 1; // tip direction (−x left, +x right)
      const tipX = a.x; // already at the edge (edgeGap)
      const baseX = a.x - dir * ARROW_LEN;
      this.arrowGfx.fillTriangle(
        tipX,
        a.y,
        baseX,
        a.y - ARROW_HALF,
        baseX,
        a.y + ARROW_HALF,
      );

      // Number label sits in the body of the triangle (just inside the base).
      const label = this.labels[labelIdx++];
      if (label) {
        label.setText(String(a.number));
        label.setPosition(a.x - dir * ARROW_LEN * 0.62, a.y);
        label.setVisible(true);
      }
    }
  }

  /** Clean up the arrow graphics + labels when the camera is destroyed. */
  destroy(): void {
    this.arrowGfx.destroy();
    for (const label of this.labels) label.destroy();
    this.labels = [];
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Build a GroupSubject from sim world-unit coordinates.
 * Use this for the player and ball (which are positioned in world units).
 */
export function subjectFromWorld(
  worldX: number,
  worldY: number,
  isPlayer?: boolean,
  team?: number,
  slot?: number,
): GroupSubject {
  return {
    screenX: toScreenX(worldX),
    screenY: toScreenY(worldY),
    isPlayer,
    team,
    slot,
  };
}

/**
 * Bell positions are static; compute them once from the ArenaDef and reuse.
 * Exported so GameScene can call it in create().
 */
export function bellSubjectFromWorld(
  worldX: number,
  worldY: number,
): GroupSubject {
  return { screenX: toScreenX(worldX), screenY: toScreenY(worldY) };
}
