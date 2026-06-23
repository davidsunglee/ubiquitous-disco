/**
 * HudScene — parallel debug/tuning overlay (launched alongside GameScene).
 *
 * Rendered at a fixed position via setScrollFactor(0) so it never scrolls with
 * the world. Communicates with GameScene through a shared registry object
 * (HudBridge) that GameScene populates in create() and HudScene reads each
 * update(). This keeps Phaser inter-scene coupling minimal.
 *
 * The DOM root element carries data-testid="hud" so Playwright can locate it.
 */

import type { DebugCollider, MatchState, SimConfig } from "@bb/sim";
import { DEFAULT_CONFIG } from "@bb/sim";
import Phaser from "phaser";
import type { NetSimPatch } from "../net/SimulatedTransport";
import { PX_PER_UNIT, toScreenX, toScreenY } from "../render/worldToScreen";

// ── Bridge interface — populated by GameScene ────────────────────────────────

export interface HudBridge {
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  /** Advance exactly one sim tick while paused. */
  step(): void;
  /** Restart the sim from scratch with the current config. */
  reset(): void;
  getConfig(): SimConfig;
  updateConfig(patch: Partial<SimConfig>): void;
  /** Returns the current debug colliders from the sim (world units). */
  getDebugColliders(): DebugCollider[];
  /** Start recording input frames into a ReplayData. */
  startCapture(): void;
  /** Stop recording and return the JSON string of the captured replay. */
  stopCapture(): string | null;
  /** Replay the last captured session (kicks off a fresh sim run). */
  replayCapture(): void;
  isCapturing(): boolean;
  /** Returns the current match state (scores, phase, timer) for HUD display. */
  getMatchState(): MatchState;
  /**
   * Returns the current network simulator params as a flat patch object.
   * Returns null when no SimulatedTransport is active (local or prod mode).
   */
  getNetSim(): Required<NetSimPatch> | null;
  /**
   * Apply a patch to the network simulator link params.
   * No-op when no SimulatedTransport is active.
   */
  updateNetSim(patch: NetSimPatch): void;
}

/** Singleton bridge. GameScene sets fields in create(); HudScene reads them. */
export const hudBridge: HudBridge = {
  isPaused: () => false,
  pause: () => {},
  resume: () => {},
  step: () => {},
  reset: () => {},
  getConfig: () => DEFAULT_CONFIG,
  updateConfig: (_patch: Partial<SimConfig>) => {},
  getDebugColliders: () => [],
  startCapture: () => {},
  stopCapture: () => null,
  replayCapture: () => {},
  isCapturing: () => false,
  getMatchState: () => ({
    phase: "preRound",
    scores: [0, 0],
    timer: DEFAULT_CONFIG.match.lengthTicks,
    pauseTicks: 0,
    resetTicks: 0,
    winner: -1,
    timerExpired: false,
  }),
  getNetSim: () => null,
  updateNetSim: (_patch: NetSimPatch) => {},
};

// ── Layout constants ─────────────────────────────────────────────────────────

const BTN_W = 80;
const BTN_H = 24;
const BTN_COLOR = 0x333355;
const BTN_HOVER = 0x555588;
const TEXT_COLOR = "#ccccff";
const LABEL_COLOR = "#aaaacc";
const SLIDER_W = 120;
const KNOB_W = 12;
const TRACK_H = 4;
const ROW_H = 34;

// Sliders: each entry defines a tunable SimConfig field.
interface SliderDef {
  label: string;
  get: (cfg: SimConfig) => number;
  set: (cfg: SimConfig, v: number) => SimConfig;
  min: number;
  max: number;
  step: number;
}

// Net-sim sliders: each entry maps to a NetSimPatch field.
interface NetSimSliderDef {
  /** Short label shown next to the slider. */
  label: string;
  /** data-testid for the DOM anchor element. */
  testid: string;
  /** Which field of NetSimPatch this slider controls. */
  field: keyof Required<NetSimPatch>;
  min: number;
  max: number;
  step: number;
}

const NET_SIM_SLIDER_DEFS: NetSimSliderDef[] = [
  {
    label: "up.delay",
    testid: "net-sim-uplink-delay",
    field: "uplinkDelayMs",
    min: 0,
    max: 300,
    step: 5,
  },
  {
    label: "up.jitter",
    testid: "net-sim-uplink-jitter",
    field: "uplinkJitterMs",
    min: 0,
    max: 100,
    step: 5,
  },
  {
    label: "up.drop",
    testid: "net-sim-uplink-drop",
    field: "uplinkDropRate",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    label: "dn.delay",
    testid: "net-sim-downlink-delay",
    field: "downlinkDelayMs",
    min: 0,
    max: 300,
    step: 5,
  },
  {
    label: "dn.jitter",
    testid: "net-sim-downlink-jitter",
    field: "downlinkJitterMs",
    min: 0,
    max: 100,
    step: 5,
  },
  {
    label: "dn.drop",
    testid: "net-sim-downlink-drop",
    field: "downlinkDropRate",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
];

const SLIDER_DEFS: SliderDef[] = [
  {
    label: "moveSpeed",
    get: (c) => c.movement.moveSpeed,
    set: (c, v) => ({ ...c, movement: { ...c.movement, moveSpeed: v } }),
    min: 1,
    max: 20,
    step: 0.5,
  },
  {
    label: "jumpSpeed",
    get: (c) => c.movement.jumpSpeed,
    set: (c, v) => ({ ...c, movement: { ...c.movement, jumpSpeed: v } }),
    min: 4,
    max: 24,
    step: 0.5,
  },
  {
    label: "dashDist",
    get: (c) => c.dash.distance,
    set: (c, v) => ({ ...c, dash: { ...c.dash, distance: v } }),
    min: 1,
    max: 10,
    step: 0.5,
  },
  {
    label: "strikeMax",
    get: (c) => c.strike.maxImpulse,
    set: (c, v) => ({ ...c, strike: { ...c.strike, maxImpulse: v } }),
    min: 4,
    max: 40,
    step: 1,
  },
  {
    label: "ballDamp",
    get: (c) => c.ball.linearDamping,
    set: (c, v) => ({ ...c, ball: { ...c.ball, linearDamping: v } }),
    min: 0,
    max: 1,
    step: 0.01,
  },
];

// ── HudScene ─────────────────────────────────────────────────────────────────

export class HudScene extends Phaser.Scene {
  private debugGfx!: Phaser.GameObjects.Graphics;
  private showColliders = false;

  // DOM root element for Playwright/test selection.
  private hudRoot!: HTMLElement;

  // Slider state: knob position and value text per slider.
  private sliders: Array<{
    def: SliderDef;
    knob: Phaser.GameObjects.Rectangle;
    valueText: Phaser.GameObjects.Text;
    trackX: number;
  }> = [];

  // Net-sim slider state.
  private netSimSliders: Array<{
    def: NetSimSliderDef;
    knob: Phaser.GameObjects.Rectangle;
    valueText: Phaser.GameObjects.Text;
    domAnchor: HTMLElement;
    trackX: number;
  }> = [];

  // Status label (pause/play state, capture).
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("HudScene");
  }

  create(): void {
    // Inject a DOM root element so Playwright can find it via data-testid="hud".
    this.hudRoot = document.createElement("div");
    this.hudRoot.dataset.testid = "hud";
    this.hudRoot.style.cssText =
      "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;";
    const parent = document.getElementById("game-container") ?? document.body;
    parent.appendChild(this.hudRoot);

    this.debugGfx = this.add.graphics();
    this.debugGfx.setDepth(1000);

    this.buildButtons();
    this.buildSliders();
    this.buildStatusText();
    this.buildNetSimSliders();
  }

  // ── Construction helpers ────────────────────────────────────────────────────

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): void {
    const bg = this.add
      .rectangle(x + BTN_W / 2, y + BTN_H / 2, BTN_W, BTN_H, BTN_COLOR)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);

    this.add
      .text(x + BTN_W / 2, y + BTN_H / 2, label, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: TEXT_COLOR,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(11);

    bg.on("pointerover", () => bg.setFillStyle(BTN_HOVER));
    bg.on("pointerout", () => bg.setFillStyle(BTN_COLOR));
    bg.on("pointerup", () => onClick());
  }

  private buildButtons(): void {
    const startX = 8;
    let bx = startX;
    const by = 8;
    const gap = 4;

    this.makeButton(bx, by, "Reset", () => hudBridge.reset());
    bx += BTN_W + gap;

    this.makeButton(bx, by, "Pause/Play", () => {
      if (hudBridge.isPaused()) {
        hudBridge.resume();
      } else {
        hudBridge.pause();
      }
    });
    bx += BTN_W + gap;

    this.makeButton(bx, by, "Step", () => hudBridge.step());
    bx += BTN_W + gap;

    this.makeButton(bx, by, "Colliders", () => {
      this.showColliders = !this.showColliders;
      if (!this.showColliders) this.debugGfx.clear();
    });
    bx += BTN_W + gap;

    this.makeButton(bx, by, "Capture", () => {
      if (hudBridge.isCapturing()) {
        const json = hudBridge.stopCapture();
        if (json) this.downloadReplay(json);
      } else {
        hudBridge.startCapture();
      }
    });
    bx += BTN_W + gap;

    this.makeButton(bx, by, "Replay", () => hudBridge.replayCapture());
  }

  private buildSliders(): void {
    const startX = 8;
    const startY = 44;

    for (let i = 0; i < SLIDER_DEFS.length; i++) {
      const def = SLIDER_DEFS[i];
      if (!def) continue;
      const y = startY + i * ROW_H;

      // Label.
      this.add
        .text(startX, y, def.label, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: LABEL_COLOR,
        })
        .setScrollFactor(0)
        .setDepth(10);

      // Track.
      const trackX = startX + 64;
      const trackY = y + 8;
      this.add
        .rectangle(trackX + SLIDER_W / 2, trackY, SLIDER_W, TRACK_H, 0x555555)
        .setScrollFactor(0)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
        .on("pointerup", (ptr: Phaser.Input.Pointer) => {
          const fraction = Phaser.Math.Clamp((ptr.x - trackX) / SLIDER_W, 0, 1);
          const raw = def.min + fraction * (def.max - def.min);
          const value = this.snap(raw, def);
          const newCfg = def.set(hudBridge.getConfig(), value);
          hudBridge.updateConfig(newCfg);
        });

      // Knob.
      const cfg = hudBridge.getConfig();
      const t = this.sliderT(def, cfg);
      const knob = this.add
        .rectangle(trackX + t * SLIDER_W, trackY, KNOB_W, 14, 0x8888cc)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true, draggable: true })
        .setDepth(11);

      // Value text.
      const valueText = this.add
        .text(trackX + SLIDER_W + 8, trackY - 4, String(def.get(cfg)), {
          fontFamily: "monospace",
          fontSize: "10px",
          color: TEXT_COLOR,
        })
        .setScrollFactor(0)
        .setDepth(10);

      // Drag handler.
      this.input.setDraggable(knob);
      knob.on("drag", (_ptr: Phaser.Input.Pointer, dragX: number) => {
        const clamped = Phaser.Math.Clamp(dragX, trackX, trackX + SLIDER_W);
        knob.x = clamped;
        const fraction = (clamped - trackX) / SLIDER_W;
        const raw = def.min + fraction * (def.max - def.min);
        const value = this.snap(raw, def);
        const newCfg = def.set(hudBridge.getConfig(), value);
        hudBridge.updateConfig(newCfg);
        valueText.setText(value.toFixed(2));
      });

      this.sliders.push({ def, knob, valueText, trackX });
    }
  }

  private buildStatusText(): void {
    this.statusText = this.add
      .text(8, 220, "", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: LABEL_COLOR,
      })
      .setScrollFactor(0)
      .setDepth(10);
  }

  /**
   * Build net-simulator sliders (uplink/downlink delay/jitter/drop).
   * These are placed in a second column (right side of the HUD) so they don't
   * overlap the sim-config sliders on the left.
   *
   * The section is hidden when no SimulatedTransport is wired
   * (getNetSim() returns null).
   */
  private buildNetSimSliders(): void {
    // Single column stacked BELOW the sim-config sliders + status line. A second
    // top-row column doesn't fit at 960px without crowding the centered
    // score/timer HUD, so we go vertical here instead.
    const startX = 8;
    const startY = 252;

    // Section header above the first net-sim row.
    this.add
      .text(startX, startY - 16, "NET SIM", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#ffcc66",
      })
      .setScrollFactor(0)
      .setDepth(10);

    const params = hudBridge.getNetSim();

    for (let i = 0; i < NET_SIM_SLIDER_DEFS.length; i++) {
      const def = NET_SIM_SLIDER_DEFS[i];
      if (!def) continue;
      const y = startY + i * ROW_H;

      // Label.
      this.add
        .text(startX, y, def.label, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: LABEL_COLOR,
        })
        .setScrollFactor(0)
        .setDepth(10);

      // DOM anchor element for Playwright / data-testid.
      const anchor = document.createElement("div");
      anchor.dataset.testid = def.testid;
      anchor.style.cssText =
        "position:absolute;width:0;height:0;overflow:visible;";
      this.hudRoot.appendChild(anchor);

      // Track. 64px label gutter (matches the sim-config column) so the longest
      // labels ("up.jitter"/"dn.jitter") clear the track start.
      const trackX = startX + 64;
      const trackY = y + 8;
      const currentVal = params ? (params[def.field] ?? 0) : 0;

      this.add
        .rectangle(trackX + SLIDER_W / 2, trackY, SLIDER_W, TRACK_H, 0x554444)
        .setScrollFactor(0)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
        .on("pointerup", (ptr: Phaser.Input.Pointer) => {
          const fraction = Phaser.Math.Clamp((ptr.x - trackX) / SLIDER_W, 0, 1);
          const raw = def.min + fraction * (def.max - def.min);
          const value = this.snapVal(raw, def.min, def.max, def.step);
          hudBridge.updateNetSim({ [def.field]: value } as NetSimPatch);
        });

      // Knob.
      const t =
        def.max > def.min ? (currentVal - def.min) / (def.max - def.min) : 0;
      const knob = this.add
        .rectangle(trackX + t * SLIDER_W, trackY, KNOB_W, 14, 0xcc8844)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true, draggable: true })
        .setDepth(11);

      // Value text.
      const valueText = this.add
        .text(trackX + SLIDER_W + 8, trackY - 4, String(currentVal), {
          fontFamily: "monospace",
          fontSize: "10px",
          color: TEXT_COLOR,
        })
        .setScrollFactor(0)
        .setDepth(10);

      // Drag handler.
      this.input.setDraggable(knob);
      knob.on("drag", (_ptr: Phaser.Input.Pointer, dragX: number) => {
        const clamped = Phaser.Math.Clamp(dragX, trackX, trackX + SLIDER_W);
        knob.x = clamped;
        const fraction = (clamped - trackX) / SLIDER_W;
        const raw = def.min + fraction * (def.max - def.min);
        const value = this.snapVal(raw, def.min, def.max, def.step);
        hudBridge.updateNetSim({ [def.field]: value } as NetSimPatch);
        valueText.setText(value.toFixed(2));
      });

      this.netSimSliders.push({
        def,
        knob,
        valueText,
        domAnchor: anchor,
        trackX,
      });
    }
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update(): void {
    // Update status line.
    const paused = hudBridge.isPaused();
    const capturing = hudBridge.isCapturing();
    this.statusText.setText(
      `${paused ? "PAUSED" : "PLAYING"} | ${capturing ? "● REC" : "○ idle"}`,
    );

    // Sync slider knob positions to the live config (in case reset() was called).
    const cfg = hudBridge.getConfig();
    for (const sl of this.sliders) {
      const t = this.sliderT(sl.def, cfg);
      sl.knob.x = sl.trackX + t * SLIDER_W;
      sl.valueText.setText(sl.def.get(cfg).toFixed(2));
    }

    // Sync net-sim slider knob positions to the live transport params.
    const netParams = hudBridge.getNetSim();
    if (netParams !== null) {
      for (const sl of this.netSimSliders) {
        const v = netParams[sl.def.field] ?? 0;
        const t =
          sl.def.max > sl.def.min
            ? (v - sl.def.min) / (sl.def.max - sl.def.min)
            : 0;
        sl.knob.x = sl.trackX + Phaser.Math.Clamp(t, 0, 1) * SLIDER_W;
        sl.valueText.setText(v.toFixed(2));
      }
    }

    // Draw debug collider overlay.
    if (this.showColliders) {
      this.debugGfx.clear();
      this.drawDebugColliders();
    }
  }

  // ── Debug overlay ───────────────────────────────────────────────────────────

  private drawDebugColliders(): void {
    const shapes = hudBridge.getDebugColliders();
    for (const shape of shapes) {
      const isHitZone = shape.label.endsWith("-hitzone");
      const isBell = shape.label.startsWith("bell-");
      const isPlayer = shape.label === "player";

      if (shape.kind === "box") {
        // Color-code by type: arena=grey, player=blue, bell art=yellow.
        let color = 0x888888;
        if (isPlayer) color = 0x33aaff;
        if (isBell) color = 0xffcc00;

        this.debugGfx
          .lineStyle(1, color, 0.7)
          .strokeRect(
            toScreenX(shape.x - shape.halfW),
            toScreenY(shape.y + shape.halfH),
            shape.halfW * 2 * PX_PER_UNIT,
            shape.halfH * 2 * PX_PER_UNIT,
          );
      } else {
        // circle: ball=yellow, Bell Hit-Zone=red (visually distinct from art).
        const color = isHitZone ? 0xff4444 : 0xffcc00;
        const alpha = isHitZone ? 0.9 : 0.7;

        this.debugGfx
          .lineStyle(isHitZone ? 2 : 1, color, alpha)
          .strokeCircle(
            toScreenX(shape.x),
            toScreenY(shape.y),
            shape.radius * PX_PER_UNIT,
          );
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Snap a raw slider value to the nearest step within [min, max]. */
  private snap(raw: number, def: SliderDef): number {
    const stepped = Math.round(raw / def.step) * def.step;
    return Phaser.Math.Clamp(stepped, def.min, def.max);
  }

  /** Generic snap for arbitrary [min, max, step] (used by net-sim sliders). */
  private snapVal(raw: number, min: number, max: number, step: number): number {
    const stepped = Math.round(raw / step) * step;
    return Phaser.Math.Clamp(stepped, min, max);
  }

  /** Map a config value to a [0,1] fraction for the slider knob. */
  private sliderT(def: SliderDef, cfg: SimConfig): number {
    const v = def.get(cfg);
    return Phaser.Math.Clamp((v - def.min) / (def.max - def.min), 0, 1);
  }

  /** Trigger a JSON download of a captured replay in the browser. */
  private downloadReplay(json: string): void {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  shutdown(): void {
    this.hudRoot?.remove();
  }
}
