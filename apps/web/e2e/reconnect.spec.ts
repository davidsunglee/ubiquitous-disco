/**
 * Reconnect e2e test (Phase 6).
 *
 * Two clients join a match via the lobby (launch handoff). One client
 * "refreshes" mid-match (simulated by closing and reopening the page with the
 * same sessionStorage launch payload intact). Within the grace window, the
 * refreshed client should reclaim the same Player Slot and resume the match.
 *
 * A second scenario exercises the late-reconnect path with the E2E server's
 * shortened grace window: the remaining client sees reconnect-expired, and the
 * stale launch token cannot create a fresh room after expiry.
 *
 * Requires:
 *   - Vite dev server (5180 / 4173 in CI)
 *   - Colyseus server at ws://127.0.0.1:2567 (with WORKER_URL/secret env)
 *   - Cloudflare Worker (Wrangler dev) at http://127.0.0.1:8787
 *
 * Skip with SKIP_NET_E2E=1 when the worker/server are unavailable.
 */

import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("mid-match refresh: refreshed client reclaims same Player Slot within grace", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker/server not running");

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // Host creates a lobby.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();

  // Guest joins by code.
  await guest.goto("/#lobby");
  await guest.getByTestId("lobby-name").fill("Bob");
  await guest.getByTestId("lobby-join-code").fill(code);
  await guest.getByTestId("lobby-join").click();
  await expect(guest.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  // Fill the remaining two slots with bots and start the match.
  await host.getByTestId("lobby-fill-bots").click();
  await host.getByTestId("lobby-start-match").click();

  // Both clients navigate into the Phaser match.
  await expect(host.locator("canvas")).toBeVisible({ timeout: 12000 });
  await expect(guest.locator("canvas")).toBeVisible({ timeout: 12000 });
  await expect(host.getByTestId("score")).toBeVisible({ timeout: 8000 });
  await expect(guest.getByTestId("score")).toBeVisible({ timeout: 8000 });

  // Let a few snapshots flow.
  await host.waitForTimeout(500);

  // Capture guest's slot by checking the launch payload in sessionStorage.
  const guestLaunch = await guest.evaluate(() =>
    sessionStorage.getItem("bb.launch"),
  );
  expect(guestLaunch).not.toBeNull();
  const guestLaunchObj = JSON.parse(guestLaunch ?? "{}") as {
    launchId: string;
    playerSlotId: number;
    joinToken: string;
  };
  const guestSlot = guestLaunchObj.playerSlotId;

  // Simulate a mid-match page refresh for the guest. The launch payload is
  // still in sessionStorage (peekLaunch doesn't clear it), so the scene will
  // automatically attempt to rejoin via the reclaim path.
  await guest.reload();

  // The guest should reconnect and show the match HUD again (RoomReady).
  await expect(guest.locator("canvas")).toBeVisible({ timeout: 12000 });
  await expect(guest.getByTestId("score")).toBeVisible({ timeout: 12000 });

  // The match should still be running (host's HUD is visible and not closed).
  await expect(host.getByTestId("score")).toBeVisible({ timeout: 5000 });
  // Host should NOT see the fail-closed banner.
  await expect(host.getByTestId("net-closed")).not.toBeVisible({
    timeout: 3000,
  });

  // Confirm guest's session storage still has the same launchId and slot.
  const guestLaunchAfter = await guest.evaluate(() =>
    sessionStorage.getItem("bb.launch"),
  );
  expect(guestLaunchAfter).not.toBeNull();
  const guestLaunchObjAfter = JSON.parse(guestLaunchAfter ?? "{}") as {
    launchId: string;
    playerSlotId: number;
  };
  expect(guestLaunchObjAfter.launchId).toBe(guestLaunchObj.launchId);
  expect(guestLaunchObjAfter.playerSlotId).toBe(guestSlot);

  await hostCtx.close();
  await guestCtx.close();
});

test("late reconnect: grace window expired → remaining client sees reconnect-expired banner", async ({
  browser,
}) => {
  test.setTimeout(45_000);
  test.skip(SKIP, "SKIP_NET_E2E set — worker/server not running");

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();

  await guest.goto("/#lobby");
  await guest.getByTestId("lobby-name").fill("Bob");
  await guest.getByTestId("lobby-join-code").fill(code);
  await guest.getByTestId("lobby-join").click();
  await expect(guest.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });
  await host.getByTestId("lobby-fill-bots").click();
  await host.getByTestId("lobby-start-match").click();

  await expect(host.locator("canvas")).toBeVisible({ timeout: 12000 });
  await expect(guest.locator("canvas")).toBeVisible({ timeout: 12000 });
  await expect(host.getByTestId("score")).toBeVisible({ timeout: 8000 });
  await expect(guest.getByTestId("score")).toBeVisible({ timeout: 8000 });
  await host.waitForTimeout(500);

  const guestLaunch = await guest.evaluate(() =>
    sessionStorage.getItem("bb.launch"),
  );
  expect(guestLaunch).not.toBeNull();
  if (guestLaunch === null) throw new Error("expected guest launch payload");
  const retainedGuestLaunch: string = guestLaunch;

  // Close the guest context (hard disconnect).
  await guestCtx.close();

  // Wait longer than the E2E grace window (1.5s + buffer).
  await host.waitForTimeout(3_000);

  // Host should see the reconnect-expired banner.
  await expect(host.getByTestId("net-closed")).toBeVisible({ timeout: 8000 });
  const bannerText = await host.getByTestId("net-closed").innerText();
  expect(bannerText).toContain("Reconnect Window Closed");

  // A stale retained launch must join only an existing room; it must not create
  // a fresh MatchRoom after the original room disposed on grace expiry.
  const lateCtx = await browser.newContext();
  await lateCtx.addInitScript((launchJson: string) => {
    const launch = JSON.parse(launchJson) as { launchId: string };
    sessionStorage.setItem("bb.launch", launchJson);
    sessionStorage.setItem("bb.launch.joined", launch.launchId);
  }, retainedGuestLaunch);
  const lateGuest = await lateCtx.newPage();
  await lateGuest.goto("/");

  await expect(lateGuest.getByTestId("net-closed")).toBeVisible({
    timeout: 8000,
  });

  await hostCtx.close();
  await lateCtx.close();
});
