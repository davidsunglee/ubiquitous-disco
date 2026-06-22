import { initSim } from "@bb/sim";
import Phaser from "phaser";
import { LobbyRouter } from "./lobby/LobbyRouter";
import { GameScene } from "./scenes/GameScene";
import { HudScene } from "./scenes/HudScene";

await initSim();

// Mount the hash-based lobby router into a container that overlays the game.
// The lobby pages are shown when the hash is #lobby or #lobby/:code.
// The Phaser game is always present in the DOM but hidden behind lobby pages
// via the z-index stacking (lobby pages mount into their own container element).
const lobbyContainer = document.createElement("div");
lobbyContainer.id = "lobby-container";
lobbyContainer.style.cssText =
  // z-index:200 sits above the in-game ConnectionOverlay (z-index:100) so that
  // lobby pages can capture pointer events when visible.
  "position:fixed;top:0;left:0;width:100%;height:100%;z-index:200;pointer-events:none;";
document.body.appendChild(lobbyContainer);

const router = new LobbyRouter();
router.mount(lobbyContainer);

// Start Phaser. It initialises into #game-container (defined in index.html).
const game = new Phaser.Game({
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

// While a lobby page (#lobby or #lobby/:code) is showing, the DOM lobby UI owns
// the keyboard. GameScene registers the gameplay keys with capture enabled, so
// Phaser's KeyboardManager preventDefaults them on `window` — which would
// otherwise swallow game-bound characters (WASD, arrows, …) before they reach a
// focused lobby <input>. Gate the global keyboard manager off on lobby routes
// and restore it for the match. Re-evaluated on every hash change; also run once
// at boot (after the keyboard manager exists) since GameScene adds its captures
// asynchronously during create().
const syncKeyboardToRoute = (): void => {
  const keyboard = game.input.keyboard;
  if (!keyboard) return;
  const lobbyActive =
    location.hash === "#lobby" || location.hash.startsWith("#lobby/");
  keyboard.enabled = !lobbyActive;
  keyboard.preventDefault = !lobbyActive;
};
game.events.once(Phaser.Core.Events.READY, syncKeyboardToRoute);
window.addEventListener("hashchange", syncKeyboardToRoute);
