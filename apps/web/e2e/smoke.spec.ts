import { expect, test } from "@playwright/test";

test("sandbox loads and renders a canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
});

test("HUD element is present in the DOM", async ({ page }) => {
  await page.goto("/");
  // Wait for the canvas first (ensures the Phaser app has initialised).
  await expect(page.locator("canvas")).toBeVisible();
  // The HudScene injects a div[data-testid="hud"] into the game container.
  await expect(page.getByTestId("hud")).toBeAttached();
});

test("local 1v1 shows match UI and start prompt clears", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  // Match HUD nodes must be attached.
  await expect(page.getByTestId("score")).toBeAttached();
  await expect(page.getByTestId("timer")).toBeAttached();
  // Start prompt is visible before any input.
  await expect(page.getByTestId("start-prompt")).toBeVisible();
  // Press P1 jump (X) to start the match. Hold it briefly so the 30Hz sim
  // accumulator has at least one tick to process the key press.
  await page.keyboard.down("x");
  await page.waitForTimeout(100); // ~3 sim ticks at 30Hz
  await page.keyboard.up("x");
  // After starting, the prompt should disappear.
  await expect(page.getByTestId("start-prompt")).toBeHidden();
});
