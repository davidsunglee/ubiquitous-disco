import {
  createSimulation,
  DEFAULT_CONFIG,
  EMPTY_INPUT,
  FLAT_DOJO,
  type Simulation,
} from "@bb/sim";
import Phaser from "phaser";
import {
  lerp,
  PX_PER_UNIT,
  toScreenX,
  toScreenY,
} from "../render/worldToScreen";

export class GameScene extends Phaser.Scene {
  private sim!: Simulation;
  private gfx!: Phaser.GameObjects.Graphics;
  private accumulator = 0;
  private readonly FIXED_STEP = 1000 / DEFAULT_CONFIG.tickHz;
  private prevBall = { x: 0, y: 0 };
  private curBall = { x: 0, y: 0 };

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
    const b = this.sim.getRenderState().ball;
    this.prevBall = { ...b };
    this.curBall = { ...b };
  }

  update(_time: number, delta: number): void {
    this.accumulator += delta;
    while (this.accumulator >= this.FIXED_STEP) {
      this.prevBall = this.curBall; // snapshot for interpolation
      this.sim.step(EMPTY_INPUT);
      this.curBall = { ...this.sim.getRenderState().ball };
      this.accumulator -= this.FIXED_STEP;
    }
    const alpha = this.accumulator / this.FIXED_STEP; // [0,1)
    const x = lerp(this.prevBall.x, this.curBall.x, alpha);
    const y = lerp(this.prevBall.y, this.curBall.y, alpha);

    this.gfx.clear();
    // ground (programmer art)
    this.gfx
      .fillStyle(0x444444, 1)
      .fillRect(
        toScreenX(-10),
        toScreenY(0),
        20 * PX_PER_UNIT,
        0.5 * PX_PER_UNIT,
      );
    // ball
    this.gfx
      .fillStyle(0xffcc00, 1)
      .fillCircle(
        toScreenX(x),
        toScreenY(y),
        DEFAULT_CONFIG.ball.radius * PX_PER_UNIT,
      );
  }
}
