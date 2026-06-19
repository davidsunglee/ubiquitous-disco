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
