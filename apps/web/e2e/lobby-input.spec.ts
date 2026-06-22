/**
 * Lobby keyboard regression test.
 *
 * The Phaser game boots underneath the lobby overlay and its KeyboardManager
 * captures the game-bound keys (WASD, arrows, …) on `window`, calling
 * preventDefault on keydown. Without gating that capture while a lobby route is
 * active, those keystrokes never reach a focused lobby <input> — e.g. typing
 * "a" in the display-name box did nothing.
 *
 * This test uses real keystrokes (pressSequentially) so the preventDefault path
 * is exercised, unlike lobby-presence.spec.ts which uses .fill() (direct DOM
 * value set). Touches only the landing page, so the worker is not required.
 *
 * Requires the Vite dev server at http://127.0.0.1:5180 (or 4173 in CI).
 */

import { expect, test } from "@playwright/test";

test("lobby name input accepts game-bound keystrokes", async ({ page }) => {
  await page.goto("/#lobby");

  const name = page.getByTestId("lobby-name");
  await name.click();
  // Clear the default profile name via the DOM, then type real keystrokes.
  await name.fill("");
  // w/a/s/d are all P1 movement keys captured by Phaser; without the fix the
  // KeyboardManager preventDefaults them and the input stays empty.
  await name.pressSequentially("wasd");

  await expect(name).toHaveValue("wasd");
});
