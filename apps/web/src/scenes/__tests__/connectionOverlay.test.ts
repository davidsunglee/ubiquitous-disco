/**
 * ConnectionOverlay.hideFailClosed tests (FLI-8 BUG #1).
 *
 * On a successful silent reconnect the stale fail-closed banner must be
 * dismissible so it can't persist over the resumed game.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { ConnectionOverlay } from "../ConnectionOverlay";

let overlay: ConnectionOverlay;

beforeEach(() => {
  document.body.innerHTML = "";
  overlay = new ConnectionOverlay();
  overlay.mount();
});

afterEach(() => {
  overlay.destroy();
  document.body.innerHTML = "";
});

function banner(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="net-closed"]');
  if (!el) throw new Error("net-closed banner not found");
  return el;
}

test("showFailClosed reveals the banner", () => {
  overlay.showFailClosed("peer-left");
  expect(banner().style.display).toBe("block");
});

test("hideFailClosed dismisses a shown banner", () => {
  overlay.showFailClosed("peer-left");
  expect(banner().style.display).toBe("block");

  overlay.hideFailClosed();

  expect(banner().style.display).toBe("none");
});
