/**
 * TouchAdapter — virtual joystick + on-screen buttons for touch devices.
 *
 * Implements the same `collect()` interface as KeyboardAdapter, feeding the
 * identical `normalizeMove` / `buildInputFrame` helpers from `@bb/sim`.
 * The resulting InputFrame is merged with the keyboard frame by GameScene
 * (whichever axis/button is active wins), so both input modes coexist.
 *
 * Layout (landscape):
 *   Lower-left:  circular analog joystick (floats to where the left zone is pressed)
 *   Lower-right: three action buttons on an arc around the bottom-right corner,
 *                evenly spaced and equidistant from the thumb pivot. Bottom→top of
 *                the arc (left→right on screen): Strike (S), Jump (J), Dash (D).
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

/** Rest position of the joystick centre (lower-left) as a fraction of canvas size. */
const JOYSTICK_BASE_X_FRAC = 0.15; // 15% from left
const JOYSTICK_BASE_Y_FRAC = 0.78; // 78% from top
/** A press anywhere in the left fraction of the screen spawns/drives the joystick. */
const JOYSTICK_ZONE_X_FRAC = 0.5;

/**
 * Action buttons: an arc hugging the bottom-right corner. This radius is the
 * single source of truth for both the drawn circle and the tap hit-test, so
 * the tappable area always exactly matches the button you see.
 */
const BTN_RADIUS = 40;
/** Arc pivot (the thumb's pivot point) = bottom-right corner. */
const BTN_ARC_PIVOT_X_FRAC = 1.0;
const BTN_ARC_PIVOT_Y_FRAC = 1.0;
/** Arc radius as a fraction of the smaller viewport dimension (keeps it on-screen). */
const BTN_ARC_RADIUS_FRAC = 0.42;
/**
 * Angle (degrees) of each button along the arc, measured from the +X axis going
 * counter-clockwise up from the bottom-right corner (90°=straight up the right
 * edge, 180°=straight left along the bottom edge). Even 22.5° spacing → 4 buttons.
 * Strike sits lowest (nearest the thumb's rest); Special highest.
 * Phase 2 (FLI-9): added Special as the 4th button.
 */
const BTN_ARC_ANGLE_DEG = {
  strike: 157.5,
  jump: 135,
  dash: 112.5,
  special: 90,
};

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
  /** Phase 2 (FLI-9): Special action button pointers. */
  private specialPointers = new Set<number>();

  private prevHeld: HeldState = {
    jump: false,
    dash: false,
    strike: false,
    special: false,
  };

  /** Graphics object for drawing the touch UI. */
  private gfx!: Phaser.GameObjects.Graphics;

  /** Button label text objects (J / D / S / Q), drawn above the graphics layer. */
  private labels!: {
    jump: Phaser.GameObjects.Text;
    dash: Phaser.GameObjects.Text;
    strike: Phaser.GameObjects.Text;
    /** Phase 2 (FLI-9): Special button label. */
    special: Phaser.GameObjects.Text;
  };

  /** Whether any touch has been detected (used to show/hide the UI). */
  private touchDetected = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Compute the three action-button centres in pixels from the current camera
   * size. Single source of truth for both drawing and hit-testing so they can
   * never drift apart. Buttons lie on an arc around the bottom-right corner.
   */
  private buttonCenters(
    cw: number,
    ch: number,
  ): {
    jump: { x: number; y: number };
    dash: { x: number; y: number };
    strike: { x: number; y: number };
    special: { x: number; y: number };
  } {
    const pivotX = cw * BTN_ARC_PIVOT_X_FRAC;
    const pivotY = ch * BTN_ARC_PIVOT_Y_FRAC;
    const r = Math.min(cw, ch) * BTN_ARC_RADIUS_FRAC;
    const at = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      // Arc rises up-left from the corner: +X via cos, screen-up via -sin.
      return { x: pivotX + Math.cos(rad) * r, y: pivotY - Math.sin(rad) * r };
    };
    return {
      strike: at(BTN_ARC_ANGLE_DEG.strike),
      jump: at(BTN_ARC_ANGLE_DEG.jump),
      dash: at(BTN_ARC_ANGLE_DEG.dash),
      special: at(BTN_ARC_ANGLE_DEG.special),
    };
  }

  /**
   * Call from the scene's create() to install pointer listeners and create
   * the touch UI graphics.
   */
  create(): void {
    // Allow up to 5 simultaneous touch points (4 action buttons + joystick).
    this.scene.input.addPointer(4);

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

    // Button labels (J / D / S / Q), pinned just above the graphics layer.
    const makeLabel = (text: string) =>
      this.scene.add
        .text(0, 0, text, {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(501)
        .setAlpha(0); // hidden until first touch
    this.labels = {
      jump: makeLabel("J"),
      dash: makeLabel("D"),
      strike: makeLabel("S"),
      // Phase 2 (FLI-9): Special button — "Q" for "Special".
      special: makeLabel("Q"),
    };

    // Pointer down — determine which element was hit.
    this.scene.input.on(
      "pointerdown",
      (ptr: Phaser.Input.Pointer) => {
        this.touchDetected = true;
        this.gfx.setAlpha(1);
        this.handlePointerDown(ptr);
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
      special: this.specialPointers.size > 0,
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

    // ── Buttons (arc around the bottom-right corner) ────────────────────────────

    const c = this.buttonCenters(cw, ch);
    this.drawButton(gfx, c.jump.x, c.jump.y, this.jumpPointers.size > 0);
    this.drawButton(gfx, c.dash.x, c.dash.y, this.dashPointers.size > 0);
    this.drawButton(gfx, c.strike.x, c.strike.y, this.strikePointers.size > 0);
    // Phase 2 (FLI-9): Special button — gold tint to distinguish it.
    this.drawButton(
      gfx,
      c.special.x,
      c.special.y,
      this.specialPointers.size > 0,
      0xffdd44,
    );

    // Position + reveal the labels (centred on each button).
    this.labels.jump.setPosition(c.jump.x, c.jump.y).setAlpha(1);
    this.labels.dash.setPosition(c.dash.x, c.dash.y).setAlpha(1);
    this.labels.strike.setPosition(c.strike.x, c.strike.y).setAlpha(1);
    this.labels.special.setPosition(c.special.x, c.special.y).setAlpha(1);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private handlePointerDown(ptr: Phaser.Input.Pointer): void {
    const px = ptr.x;
    const py = ptr.y;

    // Read the camera size live (same source drawUI uses) so the hit-test
    // geometry can never drift from what's drawn on screen.
    const cam = this.scene.cameras.main;
    const cw = cam.width;
    const ch = cam.height;

    // Check buttons first (arc in the lower-right).
    const c = this.buttonCenters(cw, ch);
    if (this.hitButton(px, py, c.jump.x, c.jump.y)) {
      this.jumpPointers.add(ptr.id);
      return;
    }
    if (this.hitButton(px, py, c.dash.x, c.dash.y)) {
      this.dashPointers.add(ptr.id);
      return;
    }
    if (this.hitButton(px, py, c.strike.x, c.strike.y)) {
      this.strikePointers.add(ptr.id);
      return;
    }
    // Phase 2 (FLI-9): Special button check.
    if (this.hitButton(px, py, c.special.x, c.special.y)) {
      this.specialPointers.add(ptr.id);
      return;
    }

    // A press in the left zone spawns/drives the floating joystick.
    if (px < cw * JOYSTICK_ZONE_X_FRAC && this.joystickPointerId === null) {
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
    this.specialPointers.delete(ptr.id); // Phase 2 (FLI-9)

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
    active: boolean,
    /** Optional base color (default white); active state brightens it. */
    baseColor = 0x888888,
  ): void {
    const alpha = active ? 0.7 : 0.3;
    const fill = active ? 0xffffff : baseColor;
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
    specialHeld: kb.specialHeld || touch.specialHeld,
    jumpPressed: kb.jumpPressed || touch.jumpPressed,
    dashPressed: kb.dashPressed || touch.dashPressed,
    strikePressed: kb.strikePressed || touch.strikePressed,
    strikeReleased: kb.strikeReleased || touch.strikeReleased,
    specialPressed: kb.specialPressed || touch.specialPressed,
  };
}
