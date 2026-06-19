import {
  buildInputFrame,
  type HeldState,
  type InputFrame,
  normalizeMove,
} from "@bb/sim";
import Phaser from "phaser";

/**
 * Gathers raw keyboard state (WASD + arrows for movement, Space/Up for Jump) and
 * normalizes it into a sim-owned InputFrame using the protected helpers. Dash and
 * Strike keys are stubbed (always up) until Phase 3 wires their actions.
 */
export class KeyboardAdapter {
  private readonly keys: {
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    space: Phaser.Input.Keyboard.Key;
  };
  private prevHeld: HeldState = { jump: false, dash: false, strike: false };

  constructor(keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: keyboard.addKey(K.LEFT),
      right: keyboard.addKey(K.RIGHT),
      up: keyboard.addKey(K.UP),
      down: keyboard.addKey(K.DOWN),
      a: keyboard.addKey(K.A),
      d: keyboard.addKey(K.D),
      w: keyboard.addKey(K.W),
      s: keyboard.addKey(K.S),
      space: keyboard.addKey(K.SPACE),
    };
  }

  /** Build one InputFrame from the current key state; call once per fixed tick. */
  collect(): InputFrame {
    const k = this.keys;
    const rawX =
      (k.right.isDown || k.d.isDown ? 1 : 0) -
      (k.left.isDown || k.a.isDown ? 1 : 0);
    // Y is up-positive in sim units (Up/W → +1).
    const rawY =
      (k.up.isDown || k.w.isDown ? 1 : 0) -
      (k.down.isDown || k.s.isDown ? 1 : 0);

    const move = normalizeMove(rawX, rawY);
    const held: HeldState = {
      jump: k.space.isDown || k.up.isDown || k.w.isDown,
      dash: false, // Phase 3
      strike: false, // Phase 3
    };

    const frame = buildInputFrame(move, held, this.prevHeld);
    this.prevHeld = held;
    return frame;
  }
}
