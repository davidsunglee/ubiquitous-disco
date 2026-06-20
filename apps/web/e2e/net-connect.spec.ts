/**
 * Two-client connect smoke test.
 *
 * Requires the Colyseus server running at ws://127.0.0.1:2567.
 * Start it with `pnpm dev:server` before running this spec.
 *
 * Skip with SKIP_NET_E2E=1 pnpm test:e2e when the server is unavailable.
 */
import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("two clients connect to a room and see 'connected' status", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — server not running");

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto("/");
  await b.goto("/");

  // Wait for the canvas to appear — ensures Phaser (and our overlay) are mounted.
  await expect(a.locator("canvas")).toBeVisible();
  await expect(b.locator("canvas")).toBeVisible();

  // A creates a room.
  await a.getByTestId("room-create").click();

  // Wait for A to show the room id.
  await expect(a.getByTestId("room-id")).not.toBeEmpty({ timeout: 5000 });
  const roomId = (await a.getByTestId("room-id").innerText()).trim();

  // B joins by id.
  await b.getByTestId("room-join").fill(roomId);
  await b.locator('[data-testid="room-join"]').press("Enter");

  // Both should show connected.
  await expect(a.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 5000,
  });
  await expect(b.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 5000,
  });

  await ctxA.close();
  await ctxB.close();
});
