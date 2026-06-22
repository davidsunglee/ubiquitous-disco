/**
 * Lobby launch e2e test (Phase 5).
 *
 * Full create → launch path: a Host creates a Private Lobby, two guests join by
 * code, the Host fills the fourth seat with a Practice Bot and starts. All three
 * humans navigate into the Phaser match (launch handoff), the 2v2 launches, and
 * all three agree on the authoritative Team score + timer.
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

test("Host + two guests + one bot: launch a 2v2 and agree on Team score + timer", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker/server not running");

  // Three separate contexts (distinct per-tab identities): host + two guests.
  const hostCtx = await browser.newContext();
  const guestCtxs = await Promise.all([0, 1].map(() => browser.newContext()));
  const host = await hostCtx.newPage();
  const guests = await Promise.all(guestCtxs.map((c) => c.newPage()));
  const ctxs = [hostCtx, ...guestCtxs];
  const pages = [host, ...guests];

  // Host creates a lobby.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  // Host controls are visible to the host.
  await expect(host.getByTestId("lobby-start-match")).toBeVisible({
    timeout: 8000,
  });

  // Two guests join by code.
  const guestNames = ["Bob", "Cara"];
  await Promise.all(
    guests.map(async (p, i) => {
      await p.goto("/#lobby");
      await p.getByTestId("lobby-name").fill(guestNames[i] ?? "Guest");
      await p.getByTestId("lobby-join-code").fill(code);
      await p.getByTestId("lobby-join").click();
      await expect(p.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });
    }),
  );

  // Host should see three humans seated (slots 0, 2, 1 in SEAT_ORDER).
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );
  await expect(host.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );
  await expect(host.getByTestId("lobby-slot-1")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Host fills the remaining empty seat(s) with a bot, then starts.
  await host.getByTestId("lobby-fill-bots").click();
  await expect(host.getByTestId("lobby-slot-3")).toHaveAttribute(
    "data-occupant",
    "bot",
    { timeout: 8000 },
  );

  await host.getByTestId("lobby-start-match").click();

  // All three humans navigate into the Phaser match and show the HUD score.
  for (const p of pages) {
    await expect(p.locator("canvas")).toBeVisible({ timeout: 12000 });
    await expect(p.getByTestId("score")).toBeVisible({ timeout: 12000 });
  }

  // Let a few authoritative snapshots flow (15 Hz).
  await host.waitForTimeout(800);

  // All three clients agree on the authoritative Team score.
  const scores = await Promise.all(
    pages.map((p) => p.getByTestId("score").innerText()),
  );
  expect(new Set(scores).size).toBe(1);

  // …and on the timer (and it's a valid m:ss).
  const timers = await Promise.all(
    pages.map((p) => p.getByTestId("timer").innerText()),
  );
  for (const t of timers) expect(t).toMatch(/^\d+:\d{2}$/);
  expect(new Set(timers).size).toBe(1);

  for (const ctx of ctxs) await ctx.close();
});
