/**
 * Fail-closed disconnect e2e test (Phase 5).
 *
 * Two clients join a room; one tab is closed; the remaining client should show
 * the fail-closed banner (`data-testid="net-closed"`).
 *
 * Also verifies that both clients observed a shared score/timer (authoritative
 * state agreement) before the disconnect.
 *
 * Requires the Colyseus server running at ws://127.0.0.1:2567.
 * Start it with `pnpm dev:server` before running this spec.
 *
 * Skip with SKIP_NET_E2E=1 pnpm test:e2e when the server is unavailable.
 */
import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("fail-closed: closing one tab shows the net-closed banner on the other", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — server not running");

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto("/");
  await b.goto("/");

  // Wait for both canvases to appear (Phaser + overlay mounted).
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

  // Both should show connected and HUD elements.
  await expect(a.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 8000,
  });
  await expect(b.getByTestId("net-status")).toContainText(/connected/i, {
    timeout: 8000,
  });

  await expect(a.getByTestId("score")).toBeVisible({ timeout: 5000 });
  await expect(b.getByTestId("score")).toBeVisible({ timeout: 5000 });
  await expect(a.getByTestId("timer")).toBeVisible({ timeout: 5000 });
  await expect(b.getByTestId("timer")).toBeVisible({ timeout: 5000 });

  // Let a few authoritative snapshots flow so both sides agree on state.
  await a.waitForTimeout(500);

  // Assert shared score and timer before disconnect (authoritative state agreement).
  const scoreA = await a.getByTestId("score").innerText();
  const scoreB = await b.getByTestId("score").innerText();
  expect(scoreA).toBe(scoreB);

  const timerA = await a.getByTestId("timer").innerText();
  const timerB = await b.getByTestId("timer").innerText();
  expect(timerA).toMatch(/^\d+:\d{2}$/);
  expect(timerB).toMatch(/^\d+:\d{2}$/);
  expect(timerA).toBe(timerB);

  // ── Disconnect: close A's tab ─────────────────────────────────────────────
  // Closing the context simulates a hard disconnect (tab close / network loss).
  await ctxA.close();

  // B should show the fail-closed banner within a reasonable timeout.
  // The banner has data-testid="net-closed" and is hidden by default.
  await expect(b.getByTestId("net-closed")).toBeVisible({ timeout: 8000 });

  // B's status badge should also reflect the closed state.
  await expect(b.getByTestId("net-status")).toContainText(
    /match over|disconnected|error/i,
    { timeout: 5000 },
  );

  await ctxB.close();
});
