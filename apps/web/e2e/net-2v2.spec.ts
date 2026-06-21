/**
 * Four-client 2v2 authoritative-state e2e test (Phase 2).
 *
 * Verifies that all four clients create/join one room, reach connected state,
 * start the match, and agree on the two Team scores + timer from the server.
 *
 * Requires the Colyseus server running at ws://127.0.0.1:2567.
 * Start it with `pnpm dev:server` before running this spec.
 *
 * Skip with SKIP_NET_E2E=1 pnpm test:e2e when the server is unavailable.
 */
import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("four clients play a 2v2 and agree on Team score + timer", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — server not running");

  // Create four isolated browser contexts (one per player): a host + three guests.
  const hostCtx = await browser.newContext();
  const guestCtxs = await Promise.all(
    [0, 1, 2].map(() => browser.newContext()),
  );
  const host = await hostCtx.newPage();
  const guests = await Promise.all(guestCtxs.map((c) => c.newPage()));
  const ctxs = [hostCtx, ...guestCtxs];
  const pages = [host, ...guests];

  // Load the app in all four tabs.
  for (const p of pages) {
    await p.goto("/");
    await expect(p.locator("canvas")).toBeVisible({ timeout: 8000 });
  }

  // The host creates a room.
  await host.getByTestId("room-create").click();

  // Wait for the host to receive a room ID.
  await expect(host.getByTestId("room-id")).not.toBeEmpty({ timeout: 8000 });
  const roomId = (await host.getByTestId("room-id").innerText()).trim();
  expect(roomId.length).toBeGreaterThan(0);

  // The three guests join by room ID.
  for (const p of guests) {
    await p.getByTestId("room-join").fill(roomId);
    await p.locator('[data-testid="room-join"]').press("Enter");
  }

  // All four should show "connected" in the status badge.
  for (const p of pages) {
    await expect(p.getByTestId("net-status")).toContainText(/connected/i, {
      timeout: 12000,
    });
  }

  // All four should show the HUD score element (room is full → match starts).
  for (const p of pages) {
    await expect(p.getByTestId("score")).toBeVisible({ timeout: 8000 });
  }

  // Wait for a few authoritative snapshots to flow (15 Hz → ~400ms for several).
  await host.waitForTimeout(600);

  // All four clients should display the same score (authoritative state agreement).
  const scores = await Promise.all(
    pages.map((p) => p.getByTestId("score").innerText()),
  );
  // Every client should show the same score string.
  expect(new Set(scores).size).toBe(1);

  // All four should show the same timer.
  const timers = await Promise.all(
    pages.map((p) => p.getByTestId("timer").innerText()),
  );
  for (const t of timers) {
    expect(t).toMatch(/^\d+:\d{2}$/);
  }
  expect(new Set(timers).size).toBe(1);

  // Clean up.
  for (const ctx of ctxs) await ctx.close();
});
