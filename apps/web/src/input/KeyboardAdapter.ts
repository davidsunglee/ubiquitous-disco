import {
  buildInputFrame,
  type HeldState,
  type InputFrame,
  normalizeMove,
} from "@bb/sim";
import Phaser from "phaser";

/**
 * Key mapping for a single player. Each field is a Phaser KeyCode integer.
 */
export interface KeyMap {
  left: number;
  right: number;
  up: number;
  down: number;
  jump: number;
  dash: number;
  strike: number;
  /** Phase 2 (FLI-9): Special action key. */
  special: number;
}

const K = Phaser.Input.Keyboard.KeyCodes;

/** P1 keyboard mapping: WASD movement, Z=strike, X=jump, C=dash, V=special. */
export const P1_KEYMAP: KeyMap = {
  left: K.A,
  right: K.D,
  up: K.W,
  down: K.S,
  jump: K.X,
  dash: K.C,
  strike: K.Z,
  special: K.V,
};

/** P2 keyboard mapping: Arrow keys movement, H=strike, J=jump, K=dash, L=special. */
export const P2_KEYMAP: KeyMap = {
  left: K.LEFT,
  right: K.RIGHT,
  up: K.UP,
  down: K.DOWN,
  jump: K.J,
  dash: K.K,
  strike: K.H,
  special: K.L,
};

/**
 * Networked play: each client controls only its own player on its own machine,
 * so both slots use the same scheme — Arrow keys to move, Z=strike, X=jump,
 * C=dash, V=special. The Z/X/C order mirrors the touch action buttons'
 * left→right layout (Strike, Jump, Dash) so keyboard and on-screen controls agree.
 */
export const NET_KEYMAP: KeyMap = {
  left: K.LEFT,
  right: K.RIGHT,
  up: K.UP,
  down: K.DOWN,
  jump: K.X,
  dash: K.C,
  strike: K.Z,
  special: K.V,
};

/**
 * Gathers raw keyboard state and normalizes it into a sim-owned InputFrame using
 * the protected helpers. Accepts a KeyMap so the same adapter can be used for
 * either player.
 */
export class KeyboardAdapter {
  private readonly keys: Record<keyof KeyMap, Phaser.Input.Keyboard.Key>;
  private prevHeld: HeldState = {
    jump: false,
    dash: false,
    strike: false,
    special: false,
  };

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, keymap: KeyMap) {
    this.keys = {
      left: keyboard.addKey(keymap.left),
      right: keyboard.addKey(keymap.right),
      up: keyboard.addKey(keymap.up),
      down: keyboard.addKey(keymap.down),
      jump: keyboard.addKey(keymap.jump),
      dash: keyboard.addKey(keymap.dash),
      strike: keyboard.addKey(keymap.strike),
      special: keyboard.addKey(keymap.special),
    };
  }

  /** Build one InputFrame from the current key state; call once per fixed tick. */
  collect(): InputFrame {
    const k = this.keys;
    const rawX = (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0);
    // Y is up-positive in sim units (Up → +1).
    const rawY = (k.up.isDown ? 1 : 0) - (k.down.isDown ? 1 : 0);

    const move = normalizeMove(rawX, rawY);
    const held: HeldState = {
      jump: k.jump.isDown,
      dash: k.dash.isDown,
      strike: k.strike.isDown,
      special: k.special.isDown,
    };

    const frame = buildInputFrame(move, held, this.prevHeld);
    this.prevHeld = held;
    return frame;
  }
}
