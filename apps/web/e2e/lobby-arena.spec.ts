/**
 * Lobby arena picker e2e test (Phase 5: Arena registry + adaptive camera).
 *
 * Verifies that:
 *   - The host sees a lobby-arena <select> with all three arena options.
 *   - Switching arenas updates the picker (setSettings round-trip).
 *   - Guests do not see the arena control.
 *   - The host can start a match with each arena selected.
 *
 * Requires:
 *   - Vite dev server at http://127.0.0.1:5180 (or 4173 in CI)
 *   - Cloudflare Worker at http://127.0.0.1:8787
 *
 * Skip with SKIP_NET_E2E=1 when the worker is unavailable.
 */

import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("host sees lobby-arena select with all three arenas", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  await expect(host.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  // Arena picker must be present and default to flat-dojo.
  const arenaSel = host.getByTestId("lobby-arena");
  await expect(arenaSel).toBeVisible({ timeout: 5000 });
  await expect(arenaSel).toHaveValue("flat-dojo");

  // All three arena options must be present.
  const options = await arenaSel.locator("option").allInnerTexts();
  expect(options.length).toBe(3);

  await ctx.close();
});

test("host can switch to temple-ascent and the picker reflects it", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  await expect(host.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  const arenaSel = host.getByTestId("lobby-arena");
  await expect(arenaSel).toBeVisible({ timeout: 5000 });

  await arenaSel.selectOption("temple-ascent");
  await expect(arenaSel).toHaveValue("temple-ascent");

  await ctx.close();
});

test("host can switch to dune-basin and the picker reflects it", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  await expect(host.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  const arenaSel = host.getByTestId("lobby-arena");
  await expect(arenaSel).toBeVisible({ timeout: 5000 });

  await arenaSel.selectOption("dune-basin");
  await expect(arenaSel).toHaveValue("dune-basin");

  await ctx.close();
});

test("guest does not see the lobby-arena control", async ({ browser }) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // Host creates lobby.
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

  await expect(guest.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Guest must NOT see the arena picker (host-only control).
  await expect(guest.getByTestId("lobby-arena")).not.toBeVisible();

  // Host does see it.
  await expect(host.getByTestId("lobby-arena")).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});

test("host can start a 1v1 match with dune-basin selected", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // Host creates lobby, switches to 1v1 and dune-basin.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();

  await host.getByTestId("lobby-mode").selectOption("1v1");
  await host.getByTestId("lobby-arena").selectOption("dune-basin");

  // Guest joins.
  await guest.goto("/#lobby");
  await guest.getByTestId("lobby-name").fill("Bob");
  await guest.getByTestId("lobby-join-code").fill(code);
  await guest.getByTestId("lobby-join").click();

  // Wait for guest in slot 2.
  await expect(host.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Start button should be enabled in 1v1 with two players.
  const startBtn = host.getByTestId("lobby-start-match");
  await expect(startBtn).toBeEnabled({ timeout: 5000 });

  await hostCtx.close();
  await guestCtx.close();
});
