import { initSim } from "@bb/sim";
import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

await initSim();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  width: 960,
  height: 540,
  backgroundColor: "#1a1a1a",
  scene: [GameScene],
});
