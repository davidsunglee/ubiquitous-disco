/**
 * Lobby presence smoke test.
 *
 * Host creates a private lobby; a guest joins by code; both pages show
 * each other's presence and seats.
 *
 * Requires:
 *   - Vite dev server at http://127.0.0.1:5180 (or 4173 in CI)
 *   - Cloudflare Worker at http://127.0.0.1:8787
 *
 * Skip with SKIP_NET_E2E=1 when the worker is unavailable.
 */

import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("Host creates lobby, guest joins by code; both see each other's presence", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctxHost = await browser.newContext();
  const ctxGuest = await browser.newContext();
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();

  // Navigate Host to the lobby landing page.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");

  // Host creates a lobby.
  await host.getByTestId("lobby-create").click();

  // Wait for the lobby page to appear and show the code.
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // Wait for Host to appear in slot 0.
  await expect(host.getByTestId("lobby-slot-0")).toContainText("Alice", {
    timeout: 8000,
  });

  // Guest navigates to landing page and joins by code.
  await guest.goto("/#lobby");
  await guest.getByTestId("lobby-name").fill("Bob");
  await guest.getByTestId("lobby-join-code").fill(code);
  await guest.getByTestId("lobby-join").click();

  // Both pages should show the lobby slots.
  await expect(guest.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  // Guest should see themselves (slot 2 = second seat in SEAT_ORDER).
  await expect(guest.getByTestId("lobby-slot-2")).toContainText("Bob", {
    timeout: 8000,
  });

  // Host should see Bob in slot 2 (presence update broadcast).
  await expect(host.getByTestId("lobby-slot-2")).toContainText("Bob", {
    timeout: 8000,
  });

  // Both should see Alice in slot 0.
  await expect(host.getByTestId("lobby-slot-0")).toContainText("Alice", {
    timeout: 5000,
  });
  await expect(guest.getByTestId("lobby-slot-0")).toContainText("Alice", {
    timeout: 5000,
  });

  await ctxHost.close();
  await ctxGuest.close();
});

test("two tabs in the same browser are distinct players (per-tab identity)", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  // A single context = shared localStorage between the two pages, exactly like
  // two tabs in one real browser window. Identity must be per-TAB so the second
  // tab takes a new seat instead of reclaiming the first tab's seat.
  const ctx = await browser.newContext();
  const host = await ctx.newPage();
  const second = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Second tab in the SAME context joins by code. It must occupy a new seat
  // (slot 2), not reclaim the host's seat (slot 0).
  await second.goto(`/#lobby/${code}`);
  await expect(host.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );
  // Host's seat is still occupied (not overwritten by the second tab).
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
  );

  await ctx.close();
});
