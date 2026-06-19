/**
 * GroupCamera — dynamic framing camera that keeps the player, ball, and both
 * Bells visible in the viewport at all times.
 *
 * Each frame:
 *  1. Compute a world-unit bounding box across all four subjects.
 *  2. Add a fixed margin in world units.
 *  3. Derive zoom as min(cam.width / bbox.w, cam.height / bbox.h), clamped to
 *     [MIN_ZOOM, MAX_ZOOM].
 *  4. Lerp the running zoom toward the target (smooth).
 *  5. Call cam.centerOn(centroidX, centroidY) so the group stays centred.
 *
 * All subject positions must be in **screen pixels** (already converted via
 * worldToScreen helpers) because Phaser's camera operates in the same pixel
 * space as game objects.
 */

import Phaser from "phaser";
import { PX_PER_UNIT, toScreenX, toScreenY } from "./worldToScreen";

// ── Config ────────────────────────────────────────────────────────────────────

/** Minimum world-unit padding around the bounding box on each side. */
const MARGIN_WU = 2.0;
/** Margin in pixels (derived from world-unit margin). */
const MARGIN_PX = MARGIN_WU * PX_PER_UNIT;

/** Zoom range — prevents zooming in too close or out too far. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;

/** Smoothing factor [0,1): higher = snappier, lower = smoother. */
const ZOOM_LERP = 0.06;
/** Positional smoothing: camera centroid approaches target each frame. */
const PAN_LERP = 0.08;

// ── Types ────────────────────────────────────────────────────────────────────

/** A subject position in screen (pixel) coordinates. */
export interface GroupSubject {
  screenX: number;
  screenY: number;
}

// ── GroupCamera ───────────────────────────────────────────────────────────────

export class GroupCamera {
  private currentZoom: number;
  private currentCx: number;
  private currentCy: number;

  constructor(private readonly cam: Phaser.Cameras.Scene2D.Camera) {
    this.currentZoom = cam.zoom;
    this.currentCx = cam.width / 2;
    this.currentCy = cam.height / 2;
  }

  /**
   * Call once per render frame (in GameScene.update, *after* collectInputFrame
   * but before drawing) with the screen-pixel positions of all subjects.
   */
  update(subjects: GroupSubject[]): void {
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

    // 3. Derive target zoom.
    const targetZoom = Phaser.Math.Clamp(
      Math.min(this.cam.width / bboxW, this.cam.height / bboxH),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    // 4. Smooth zoom.
    this.currentZoom += (targetZoom - this.currentZoom) * ZOOM_LERP;
    this.cam.setZoom(this.currentZoom);

    // 5. Smooth pan toward the centroid.
    const targetCx = (minX + maxX) / 2;
    const targetCy = (minY + maxY) / 2;
    this.currentCx += (targetCx - this.currentCx) * PAN_LERP;
    this.currentCy += (targetCy - this.currentCy) * PAN_LERP;

    this.cam.centerOn(this.currentCx, this.currentCy);
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Build a GroupSubject from sim world-unit coordinates.
 * Use this for the player and ball (which are positioned in world units).
 */
export function subjectFromWorld(worldX: number, worldY: number): GroupSubject {
  return { screenX: toScreenX(worldX), screenY: toScreenY(worldY) };
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
