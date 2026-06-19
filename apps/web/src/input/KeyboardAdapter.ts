import {
  buildInputFrame,
  type HeldState,
  type InputFrame,
  normalizeMove,
} from "@bb/sim";
import Phaser from "phaser";

/**
 * Gathers raw keyboard state and normalizes it into a sim-owned InputFrame using
 * the protected helpers:
 *  - movement: arrow keys,
 *  - Jump: Space / Up,
 *  - Tele-Dash: D,
 *  - Strike: S (held-to-charge, released to fire).
 * Edge flags (pressed/released) are derived from the previous frame's held state.
 */
export class KeyboardAdapter {
  private readonly keys: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    strike: Phaser.Input.Keyboard.Key;
  };
  private prevHeld: HeldState = { jump: false, dash: false, strike: false };

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: keyboard.addKey(K.LEFT),
      right: keyboard.addKey(K.RIGHT),
      up: keyboard.addKey(K.UP),
      down: keyboard.addKey(K.DOWN),
      space: keyboard.addKey(K.SPACE),
      dash: keyboard.addKey(K.D),
      strike: keyboard.addKey(K.S),
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
      jump: k.space.isDown || k.up.isDown,
      dash: k.dash.isDown,
      strike: k.strike.isDown,
    };

    const frame = buildInputFrame(move, held, this.prevHeld);
    this.prevHeld = held;
    return frame;
  }
}
