/**
 * Orientation e2e tests — Phase 6.
 *
 * At a portrait viewport the rotate-device overlay must be visible.
 * At a landscape viewport the overlay must be hidden and the canvas interactive.
 *
 * Note on the webServer host/IPv6 quirk documented in Phase 2:
 *   Vite 8 binds to 127.0.0.1 (IPv4) when `host: '127.0.0.1'` is set in
 *   vite.config.ts. The playwright.config.ts explicitly targets
 *   http://127.0.0.1:5180 in non-CI mode to avoid the IPv6/IPv4 mismatch.
 */

import { expect, test } from "@playwright/test";

// Portrait viewport: taller than wide.
test.describe("portrait orientation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("rotate-device overlay is visible in portrait", async ({ page }) => {
    await page.goto("/");

    // Wait for the canvas to confirm the app has booted.
    await expect(page.locator("canvas")).toBeVisible();

    // The OrientationOverlay injects div[data-testid="rotate-prompt"].
    const prompt = page.getByTestId("rotate-prompt");
    await expect(prompt).toBeAttached();

    // In portrait the overlay should be visible (visibility:visible).
    // We check CSS visibility because the element is always in the DOM.
    await expect(prompt).toBeVisible();
  });
});

// Landscape viewport: wider than tall.
test.describe("landscape orientation", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("rotate-device overlay is hidden in landscape", async ({ page }) => {
    await page.goto("/");

    // Canvas must be present and visible.
    await expect(page.locator("canvas")).toBeVisible();

    // The overlay element should be in the DOM but hidden.
    const prompt = page.getByTestId("rotate-prompt");
    await expect(prompt).toBeAttached();

    // In landscape the overlay should be hidden (visibility:hidden).
    await expect(prompt).toBeHidden();
  });

  test("canvas is interactive in landscape", async ({ page }) => {
    await page.goto("/");

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // Verify the canvas has a non-zero bounding box (i.e. it is rendered and
    // not collapsed/covered).
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });
});
