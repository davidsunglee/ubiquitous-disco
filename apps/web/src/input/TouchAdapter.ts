/**
 * TouchAdapter — virtual joystick + on-screen buttons for touch devices.
 *
 * Implements the same `collect()` interface as KeyboardAdapter, feeding the
 * identical `normalizeMove` / `buildInputFrame` helpers from `@bb/sim`.
 * The resulting InputFrame is merged with the keyboard frame by GameScene
 * (whichever axis/button is active wins), so both input modes coexist.
 *
 * Layout (landscape):
 *   Left half of screen:  circular analog joystick (drag from base point)
 *   Right half of screen: Jump (top), Dash (middle), Strike (bottom) buttons
 *
 * The joystick is implemented as a lightweight canvas-pointer handler rather
 * than a heavy external plugin, giving identical forceX/forceY semantics.
 * The radius used for normalization is JOYSTICK_RADIUS.
 */

import {
  buildInputFrame,
  type HeldState,
  type InputFrame,
  normalizeMove,
} from "@bb/sim";
import Phaser from "phaser";

// ── Config ────────────────────────────────────────────────────────────────────

/** Radius of the virtual joystick knob travel area (pixels). */
const JOYSTICK_RADIUS = 60;

/** Base (rest) position of the joystick centre as a fraction of canvas size. */
const JOYSTICK_BASE_X_FRAC = 0.2; // 20% from left
const JOYSTICK_BASE_Y_FRAC = 0.75; // 75% from top

/** Button layout on the right side. */
const BTN_RADIUS = 36;
const BTN_RIGHT_X_FRAC = 0.82;
const BTN_JUMP_Y_FRAC = 0.45;
const BTN_DASH_Y_FRAC = 0.65;
const BTN_STRIKE_Y_FRAC = 0.82;

// ── Helpers ───────────────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── TouchAdapter ──────────────────────────────────────────────────────────────

export class TouchAdapter {
  /** Force vector from joystick in pixels, range [-JOYSTICK_RADIUS, JOYSTICK_RADIUS]. */
  private forceX = 0;
  private forceY = 0;

  /** Which pointer ID (if any) is currently driving the joystick. */
  private joystickPointerId: number | null = null;
  /** Starting position of the joystick pointer down event. */
  private joystickBaseX = 0;
  private joystickBaseY = 0;

  /** Current knob screen position (for rendering). */
  private knobX = 0;
  private knobY = 0;

  /** Button held state, keyed by pointer ID. */
  private jumpPointers = new Set<number>();
  private dashPointers = new Set<number>();
  private strikePointers = new Set<number>();

  private prevHeld: HeldState = { jump: false, dash: false, strike: false };

  /** Graphics object for drawing the touch UI. */
  private gfx!: Phaser.GameObjects.Graphics;

  /** Whether any touch has been detected (used to show/hide the UI). */
  private touchDetected = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Call from the scene's create() to install pointer listeners and create
   * the touch UI graphics.
   */
  create(): void {
    // Allow up to 4 simultaneous touch points.
    this.scene.input.addPointer(3);

    const cam = this.scene.cameras.main;
    const cw = cam.width;
    const ch = cam.height;

    // Place the joystick base at its rest position.
    this.joystickBaseX = cw * JOYSTICK_BASE_X_FRAC;
    this.joystickBaseY = ch * JOYSTICK_BASE_Y_FRAC;
    this.knobX = this.joystickBaseX;
    this.knobY = this.joystickBaseY;

    // Create the overlay graphics (pinned, above game objects).
    this.gfx = this.scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(500)
      .setAlpha(0); // hidden until first touch

    // Pointer down — determine which element was hit.
    this.scene.input.on(
      "pointerdown",
      (ptr: Phaser.Input.Pointer) => {
        this.touchDetected = true;
        this.gfx.setAlpha(1);
        this.handlePointerDown(ptr, cw, ch);
      },
      this,
    );

    // Pointer move — update joystick knob position.
    this.scene.input.on(
      "pointermove",
      (ptr: Phaser.Input.Pointer) => {
        if (ptr.id === this.joystickPointerId) {
          this.updateJoystick(ptr.x, ptr.y);
        }
      },
      this,
    );

    // Pointer up — release joystick or button.
    this.scene.input.on(
      "pointerup",
      (ptr: Phaser.Input.Pointer) => {
        this.handlePointerUp(ptr);
      },
      this,
    );
  }

  // ── Public interface (matches KeyboardAdapter) ────────────────────────────

  /** Collect one InputFrame from the current touch state; call once per fixed tick. */
  collect(): InputFrame {
    const nx = this.forceX / JOYSTICK_RADIUS;
    // Joystick Y is screen-down; sim Y is up. Negate to convert.
    const ny = -(this.forceY / JOYSTICK_RADIUS);
    const move = normalizeMove(nx, ny);

    const held: HeldState = {
      jump: this.jumpPointers.size > 0,
      dash: this.dashPointers.size > 0,
      strike: this.strikePointers.size > 0,
    };

    const frame = buildInputFrame(move, held, this.prevHeld);
    this.prevHeld = held;
    return frame;
  }

  /**
   * Draw the virtual joystick and buttons. Call once per render frame from
   * GameScene.update() AFTER the sim step (so it overlays everything).
   * Only shown after the first touch event.
   */
  drawUI(): void {
    if (!this.touchDetected) return;
    const gfx = this.gfx;
    gfx.clear();

    const cam = this.scene.cameras.main;
    const cw = cam.width;
    const ch = cam.height;

    // ── Joystick ──────────────────────────────────────────────────────────────

    // Outer ring (base).
    gfx
      .lineStyle(2, 0xffffff, 0.3)
      .strokeCircle(this.joystickBaseX, this.joystickBaseY, JOYSTICK_RADIUS);
    // Knob fill.
    gfx
      .fillStyle(0xffffff, 0.35)
      .fillCircle(this.knobX, this.knobY, JOYSTICK_RADIUS * 0.35);

    // ── Buttons ───────────────────────────────────────────────────────────────

    const bx = cw * BTN_RIGHT_X_FRAC;
    this.drawButton(
      gfx,
      bx,
      ch * BTN_JUMP_Y_FRAC,
      "↑",
      this.jumpPointers.size > 0,
    );
    this.drawButton(
      gfx,
      bx,
      ch * BTN_DASH_Y_FRAC,
      "D",
      this.dashPointers.size > 0,
    );
    this.drawButton(
      gfx,
      bx,
      ch * BTN_STRIKE_Y_FRAC,
      "S",
      this.strikePointers.size > 0,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private handlePointerDown(
    ptr: Phaser.Input.Pointer,
    cw: number,
    ch: number,
  ): void {
    const px = ptr.x;
    const py = ptr.y;

    // Check buttons first (right half).
    if (this.hitButton(px, py, cw * BTN_RIGHT_X_FRAC, ch * BTN_JUMP_Y_FRAC)) {
      this.jumpPointers.add(ptr.id);
      return;
    }
    if (this.hitButton(px, py, cw * BTN_RIGHT_X_FRAC, ch * BTN_DASH_Y_FRAC)) {
      this.dashPointers.add(ptr.id);
      return;
    }
    if (this.hitButton(px, py, cw * BTN_RIGHT_X_FRAC, ch * BTN_STRIKE_Y_FRAC)) {
      this.strikePointers.add(ptr.id);
      return;
    }

    // Anything on the left half drives the joystick.
    if (px < cw * 0.6 && this.joystickPointerId === null) {
      this.joystickPointerId = ptr.id;
      this.joystickBaseX = px;
      this.joystickBaseY = py;
      this.knobX = px;
      this.knobY = py;
      this.forceX = 0;
      this.forceY = 0;
    }
  }

  private handlePointerUp(ptr: Phaser.Input.Pointer): void {
    this.jumpPointers.delete(ptr.id);
    this.dashPointers.delete(ptr.id);
    this.strikePointers.delete(ptr.id);

    if (ptr.id === this.joystickPointerId) {
      this.joystickPointerId = null;
      this.forceX = 0;
      this.forceY = 0;
      this.knobX = this.joystickBaseX;
      this.knobY = this.joystickBaseY;
    }
  }

  private updateJoystick(px: number, py: number): void {
    const dx = px - this.joystickBaseX;
    const dy = py - this.joystickBaseY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > JOYSTICK_RADIUS) {
      this.forceX = (dx / d) * JOYSTICK_RADIUS;
      this.forceY = (dy / d) * JOYSTICK_RADIUS;
    } else {
      this.forceX = dx;
      this.forceY = dy;
    }
    this.knobX = this.joystickBaseX + this.forceX;
    this.knobY = this.joystickBaseY + this.forceY;
  }

  private hitButton(px: number, py: number, bx: number, by: number): boolean {
    return dist(px, py, bx, by) <= BTN_RADIUS;
  }

  private drawButton(
    gfx: Phaser.GameObjects.Graphics,
    bx: number,
    by: number,
    _label: string,
    active: boolean,
  ): void {
    const alpha = active ? 0.7 : 0.3;
    const fill = active ? 0xffffff : 0x888888;
    gfx.fillStyle(fill, alpha).fillCircle(bx, by, BTN_RADIUS);
    gfx.lineStyle(2, 0xffffff, 0.5).strokeCircle(bx, by, BTN_RADIUS);
  }
}

// ── Frame merger ──────────────────────────────────────────────────────────────

/**
 * Merge keyboard and touch InputFrames into one. Analog axes add (clamped to
 * [-1,1]); boolean fields OR. Edge flags (pressed/released) are also OR-ed so
 * a press on either device registers. This preserves full keyboard functionality
 * while touch adds its own inputs on top.
 */
export function mergeInputFrames(
  kb: InputFrame,
  touch: InputFrame,
): InputFrame {
  return {
    moveX: Phaser.Math.Clamp(kb.moveX + touch.moveX, -1, 1),
    moveY: Phaser.Math.Clamp(kb.moveY + touch.moveY, -1, 1),
    jumpHeld: kb.jumpHeld || touch.jumpHeld,
    dashHeld: kb.dashHeld || touch.dashHeld,
    strikeHeld: kb.strikeHeld || touch.strikeHeld,
    jumpPressed: kb.jumpPressed || touch.jumpPressed,
    dashPressed: kb.dashPressed || touch.dashPressed,
    strikePressed: kb.strikePressed || touch.strikePressed,
    strikeReleased: kb.strikeReleased || touch.strikeReleased,
  };
}
