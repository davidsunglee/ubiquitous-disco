import { expect, test } from "@playwright/test";

test("sandbox loads and renders a canvas", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
});
