import { initSim } from "@bb/sim";
import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";
import { HudScene } from "./scenes/HudScene";

await initSim();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#1a1a1a",
  // Keep the 960x540 logical resolution but scale the canvas to fit any window,
  // preserving aspect ratio (letterboxed) and centering it. All gameplay,
  // camera, and touch-control coordinates stay in 960x540 space; Phaser handles
  // the pixel transform, so on-canvas UI (joystick/buttons/HUD) scales for free.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  scene: [GameScene, HudScene],
});
