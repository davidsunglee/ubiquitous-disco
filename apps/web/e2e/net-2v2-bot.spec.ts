/**
 * 2v2 with Practice Bot e2e test (Phase 3).
 *
 * Verifies that three human clients + one server-side Practice Bot can join a
 * room, reach connected state, and all three humans agree on Team score + timer
 * (the bot occupies slot 3 and is never a browser client).
 *
 * Requires the Colyseus server running at ws://127.0.0.1:2567.
 * Start it with `pnpm dev:server` before running this spec.
 *
 * Skip with SKIP_NET_E2E=1 pnpm test:e2e when the server is unavailable.
 */
import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("three human clients + one bot play a 2v2 and agree on Team score + timer", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — server not running");

  // Three browser contexts: one host + two guests.
  // The fourth slot (slot 3) is a Practice Bot on the server.
  const hostCtx = await browser.newContext();
  const guestCtxs = await Promise.all([0, 1].map(() => browser.newContext()));
  const host = await hostCtx.newPage();
  const guests = await Promise.all(guestCtxs.map((c) => c.newPage()));
  const ctxs = [hostCtx, ...guestCtxs];
  const pages = [host, ...guests];

  // Load the app in all three tabs.
  for (const p of pages) {
    await p.goto("/");
    await expect(p.locator("canvas")).toBeVisible({ timeout: 8000 });
  }

  // The host creates a room with slot 3 as a bot.
  // Use URL params to signal the bot slot to the web app create handler.
  // We navigate the host to /?botSlot=3 so the ConnectionOverlay passes it.
  await host.goto("/?botSlot=3");
  await expect(host.locator("canvas")).toBeVisible({ timeout: 8000 });
  await host.getByTestId("room-create").click();

  // Wait for the host to receive a room ID.
  await expect(host.getByTestId("room-id")).not.toBeEmpty({ timeout: 8000 });
  const roomId = (await host.getByTestId("room-id").innerText()).trim();
  expect(roomId.length).toBeGreaterThan(0);

  // The two guests join by room ID.
  for (const p of guests) {
    await p.getByTestId("room-join").fill(roomId);
    await p.locator('[data-testid="room-join"]').press("Enter");
  }

  // All three should show "connected" in the status badge.
  for (const p of pages) {
    await expect(p.getByTestId("net-status")).toContainText(/connected/i, {
      timeout: 12000,
    });
  }

  // All three should show the HUD score element (room is full → match starts).
  for (const p of pages) {
    await expect(p.getByTestId("score")).toBeVisible({ timeout: 8000 });
  }

  // Wait for a few authoritative snapshots (15 Hz → ~400ms for several).
  await host.waitForTimeout(600);

  // All three clients should display the same score (authoritative state agreement).
  const scores = await Promise.all(
    pages.map((p) => p.getByTestId("score").innerText()),
  );
  expect(new Set(scores).size).toBe(1);

  // All three should show the same timer.
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
