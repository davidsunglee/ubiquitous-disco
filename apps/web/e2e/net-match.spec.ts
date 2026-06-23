/**
 * Two-client authoritative-state e2e test (Phase 2).
 *
 * Verifies that both clients receive and display the same authoritative
 * score and timer from the server.
 *
 * Requires the Colyseus server running at ws://127.0.0.1:2567.
 * Start it with `pnpm dev:server` before running this spec.
 *
 * Skip with SKIP_NET_E2E=1 pnpm test:e2e when the server is unavailable.
 */
import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("two clients see identical score and timer from the authoritative server", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — server not running");

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto("/?direct=1");
  await b.goto("/?direct=1");

  // Wait for canvas to appear (Phaser + overlay mounted).
  await expect(a.locator("canvas")).toBeVisible({ timeout: 8000 });
  await expect(b.locator("canvas")).toBeVisible({ timeout: 8000 });

  // A creates a room.
  await a.getByTestId("room-create").click();

  // Wait for A to get a room ID.
  await expect(a.getByTestId("room-id")).not.toBeEmpty({ timeout: 8000 });
  const roomId = (await a.getByTestId("room-id").innerText()).trim();
  expect(roomId.length).toBeGreaterThan(0);

  // B joins by id (fill + Enter).
  await b.getByTestId("room-join").fill(roomId);
  await b.locator('[data-testid="room-join"]').press("Enter");

  // Both should show connected.
  await expect(a.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 8000,
  });
  await expect(b.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 8000,
  });

  // Both should show the HUD (score + timer visible).
  await expect(a.getByTestId("score")).toBeVisible({ timeout: 5000 });
  await expect(b.getByTestId("score")).toBeVisible({ timeout: 5000 });
  await expect(a.getByTestId("timer")).toBeVisible({ timeout: 5000 });
  await expect(b.getByTestId("timer")).toBeVisible({ timeout: 5000 });

  // Wait a moment for snapshots to flow (15 Hz → ~200ms for a few snapshots).
  await a.waitForTimeout(500);

  // Both clients should show the same score (authoritative state).
  const scoreA = await a.getByTestId("score").innerText();
  const scoreB = await b.getByTestId("score").innerText();
  expect(scoreA).toBe(scoreB);

  // Both clients should show roughly the same timer (may differ by ≤1 display
  // tick due to rendering lag, but format should match).
  const timerA = await a.getByTestId("timer").innerText();
  const timerB = await b.getByTestId("timer").innerText();
  // Timers should be in "M:SS" format and close to each other.
  expect(timerA).toMatch(/^\d+:\d{2}$/);
  expect(timerB).toMatch(/^\d+:\d{2}$/);
  // Both should be near the match start (≥ 2:58 for a 3:00 match).
  expect(timerA).toBe(timerB);

  await ctxA.close();
  await ctxB.close();
});
