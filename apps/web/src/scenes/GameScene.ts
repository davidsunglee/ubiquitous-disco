import {
  createSimulation,
  DEFAULT_CONFIG,
  FLAT_DOJO,
  type InputFrame,
  type RenderState,
  type Simulation,
} from "@bb/sim";
import Phaser from "phaser";
import { KeyboardAdapter } from "../input/KeyboardAdapter";
import {
  lerp,
  PX_PER_UNIT,
  toScreenX,
  toScreenY,
} from "../render/worldToScreen";

export class GameScene extends Phaser.Scene {
  private sim!: Simulation;
  private gfx!: Phaser.GameObjects.Graphics;
  private keyboard!: KeyboardAdapter;
  private accumulator = 0;
  private readonly FIXED_STEP = 1000 / DEFAULT_CONFIG.tickHz;
  private prev!: RenderState;
  private cur!: RenderState;
  // Bell Ring feedback: a banner that fades out, plus a per-Bell flash timer.
  private bellText!: Phaser.GameObjects.Text;
  private bellFlash: { left: number; right: number } = { left: 0, right: 0 };

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 1234,
    });
    this.gfx = this.add.graphics();
    if (!this.input.keyboard) {
      throw new Error("Keyboard input plugin unavailable");
    }
    this.keyboard = new KeyboardAdapter(this.input.keyboard);
    const s = this.sim.getRenderState();
    this.prev = structuredClone(s);
    this.cur = structuredClone(s);

    // Bell Ring banner (hidden until a Bell rings). Drawn above the canvas-center.
    this.bellText = this.add
      .text(480, 60, "", {
        fontFamily: "monospace",
        fontSize: "40px",
        color: "#ffe066",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);
  }

  private collectInputFrame(): InputFrame {
    return this.keyboard.collect();
  }

  update(_time: number, delta: number): void {
    this.accumulator += delta;
    while (this.accumulator >= this.FIXED_STEP) {
      this.prev = this.cur;
      this.sim.step(this.collectInputFrame());
      this.cur = structuredClone(this.sim.getRenderState());
      // Drain sim events each tick and surface Bell Ring feedback.
      for (const event of this.sim.drainEvents()) {
        if (event.type === "bellRing") this.onBellRing(event.bell);
      }
      this.accumulator -= this.FIXED_STEP;
    }
    const alpha = this.accumulator / this.FIXED_STEP; // [0,1)

    this.gfx.clear();
    this.drawArena();
    this.drawBells();
    this.drawBall(alpha);
    this.drawPlayer(alpha);
    this.tickBellFeedback(delta);
  }

  /**
   * Bell Ring feedback (obvious, tagged with the side): flash the rung Bell and
   * show a banner. A sound stub is logged so audio can hang off this hook later.
   */
  private onBellRing(bell: "left" | "right"): void {
    this.bellFlash[bell] = 1; // full intensity, decays in tickBellFeedback
    const label = bell === "left" ? "LEFT BELL!" : "RIGHT BELL!";
    this.bellText
      .setText(label)
      .setColor(bell === "left" ? "#66d9ff" : "#ff9966")
      .setAlpha(1);
    // Sound stub — wire real SFX here in a later art/audio pass.
    console.info(`[bellRing] ${bell}`);
  }

  /** Decay the banner alpha and per-Bell flash intensity over real time. */
  private tickBellFeedback(delta: number): void {
    const decay = delta / 1000; // ~1s fade
    this.bellFlash.left = Math.max(0, this.bellFlash.left - decay);
    this.bellFlash.right = Math.max(0, this.bellFlash.right - decay);
    if (this.bellText.alpha > 0) {
      this.bellText.setAlpha(Math.max(0, this.bellText.alpha - decay * 0.8));
    }
  }

  private drawArena(): void {
    this.gfx.fillStyle(0x444444, 1);
    for (const c of FLAT_DOJO.colliders) {
      this.gfx.fillRect(
        toScreenX(c.x - c.halfW),
        toScreenY(c.y + c.halfH),
        c.halfW * 2 * PX_PER_UNIT,
        c.halfH * 2 * PX_PER_UNIT,
      );
    }
  }

  /**
   * Render the two Bells (art shapes only — the hit-zone is intentionally
   * invisible here; the Phase 5 debug overlay draws it). A rung Bell flashes
   * brighter for a moment via bellFlash.
   */
  private drawBells(): void {
    for (const bell of FLAT_DOJO.bells) {
      const art = bell.art;
      const flash = this.bellFlash[bell.id];
      const base = bell.id === "left" ? 0x3aa0c0 : 0xc06a3a;
      const color = flash > 0 ? 0xffffff : base;
      this.gfx
        .fillStyle(color, 1)
        .fillRect(
          toScreenX(art.x - art.halfW),
          toScreenY(art.y + art.halfH),
          art.halfW * 2 * PX_PER_UNIT,
          art.halfH * 2 * PX_PER_UNIT,
        );
      if (flash > 0) {
        this.gfx
          .lineStyle(3, 0xffe066, flash)
          .strokeCircle(
            toScreenX(art.x),
            toScreenY(art.y),
            (art.halfW + 0.4) * PX_PER_UNIT,
          );
      }
    }
  }

  private drawBall(alpha: number): void {
    const x = lerp(this.prev.ball.x, this.cur.ball.x, alpha);
    const y = lerp(this.prev.ball.y, this.cur.ball.y, alpha);
    this.gfx
      .fillStyle(0xffcc00, 1)
      .fillCircle(
        toScreenX(x),
        toScreenY(y),
        this.cur.ball.radius * PX_PER_UNIT,
      );
  }

  private drawPlayer(alpha: number): void {
    const x = lerp(this.prev.player.x, this.cur.player.x, alpha);
    const y = lerp(this.prev.player.y, this.cur.player.y, alpha);
    const halfW = DEFAULT_CONFIG.player.halfW;
    const halfH = DEFAULT_CONFIG.player.halfH;
    const color = this.cur.player.grounded ? 0x33aaff : 0x55ccff;
    this.gfx
      .fillStyle(color, 1)
      .fillRect(
        toScreenX(x - halfW),
        toScreenY(y + halfH),
        halfW * 2 * PX_PER_UNIT,
        halfH * 2 * PX_PER_UNIT,
      );
    // facing indicator: a notch on the leading edge
    const facing = this.cur.player.facing;
    const noseX = toScreenX(x + facing * halfW);
    this.gfx
      .fillStyle(0xffffff, 1)
      .fillCircle(noseX, toScreenY(y + halfH * 0.4), 4);

    this.drawChargeFeedback(x, y, halfW, halfH);
  }

  /**
   * Strike charge feedback: a ring around the player whose radius and color
   * intensity grow with RenderState.player.charge (ticks). charge is 0 when not
   * charging, so the ring only appears while holding Strike.
   */
  private drawChargeFeedback(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
  ): void {
    const charge = this.cur.player.charge;
    if (charge <= 0) return;
    const max = DEFAULT_CONFIG.strike.maxChargeTicks;
    const t = Math.min(1, charge / max);
    const cx = toScreenX(x);
    const cy = toScreenY(y + halfH * 0.25);
    const baseR = Math.max(halfW, halfH) * PX_PER_UNIT;
    const ringR = baseR + 6 + t * 18;
    // Warmer/brighter as the charge nears full.
    const color = t >= 0.999 ? 0xff5522 : 0xffaa33;
    this.gfx
      .lineStyle(2 + t * 3, color, 0.35 + t * 0.5)
      .strokeCircle(cx, cy, ringR);
  }
}
