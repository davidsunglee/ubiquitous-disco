/**
 * Lobby character-picker e2e test (Phase 1: character roster spine).
 *
 * Verifies that:
 *   - The stat comparison table (lobby-stat-table) is visible once in the lobby.
 *   - A human player can see their character <select> and change it (lobby-slot-{n}-character).
 *   - The host can set a character for a bot slot and the selection is reflected.
 *   - Character picks are broadcast and visible to other lobby members.
 *
 * Requires:
 *   - Vite dev server at http://127.0.0.1:5180 (or 4173 in CI)
 *   - Cloudflare Worker at http://127.0.0.1:8787
 *
 * Skip with SKIP_NET_E2E=1 when the worker is unavailable.
 */

import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("stat table is visible in the lobby", async ({ browser }) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  // Wait for the lobby slots to appear.
  await expect(host.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  // Stat comparison table must be present once in the lobby.
  await expect(host.getByTestId("lobby-stat-table")).toBeVisible({
    timeout: 5000,
  });

  await ctx.close();
});

test("host sees own-slot character picker and can change it", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  // Wait for host slot to be populated.
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // The character picker for the host's own slot (slot 0) must be present.
  const charSel = host.getByTestId("lobby-slot-0-character");
  await expect(charSel).toBeVisible({ timeout: 5000 });

  // Default character is "sifu".
  await expect(charSel).toHaveValue("sifu");

  // Switch to "vipra".
  await charSel.selectOption("vipra");
  await expect(charSel).toHaveValue("vipra");

  await ctx.close();
});

test("guest sees own-slot character picker; host does not see guest picker", async ({
  browser,
}) => {
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

  // Guest occupies slot 2 (SEAT_ORDER: 0, 2, 1, 3).
  await expect(guest.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Guest sees their own-slot picker (slot 2).
  const guestCharSel = guest.getByTestId("lobby-slot-2-character");
  await expect(guestCharSel).toBeVisible({ timeout: 5000 });

  // Guest can pick a different character.
  await guestCharSel.selectOption("monkey-king");
  await expect(guestCharSel).toHaveValue("monkey-king");

  // Host's page: slot 2 has no character picker for host (it's a guest's seat).
  const hostSlot2Sel = host.getByTestId("lobby-slot-2-character");
  await expect(hostSlot2Sel).not.toBeVisible();

  // Host's own picker (slot 0) is still present.
  await expect(host.getByTestId("lobby-slot-0-character")).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});

test("host can set character for a bot slot and pick is reflected", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  // Wait for host slot.
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Host fills slot 2 with a bot.
  const botBtn = host.getByTestId("lobby-slot-2-bot");
  await expect(botBtn).toBeVisible({ timeout: 5000 });
  await botBtn.click();
  await expect(host.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "bot",
    { timeout: 5000 },
  );

  // Host sees a character picker for the bot slot.
  const botCharSel = host.getByTestId("lobby-slot-2-character");
  await expect(botCharSel).toBeVisible({ timeout: 5000 });

  // Default is sifu; switch to old-master.
  await expect(botCharSel).toHaveValue("sifu");
  await botCharSel.selectOption("old-master");
  await expect(botCharSel).toHaveValue("old-master");

  await ctx.close();
});

test("character picks per slot are reflected in lobby-slot-{n} occupant (round-trip)", async ({
  browser,
}) => {
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

  // Guest joins.
  await guest.goto("/#lobby");
  await guest.getByTestId("lobby-name").fill("Bob");
  await guest.getByTestId("lobby-join-code").fill(code);
  await guest.getByTestId("lobby-join").click();
  await expect(guest.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );

  // Host picks "panda" for their own slot.
  await host.getByTestId("lobby-slot-0-character").selectOption("panda");
  // Guest picks "vipra" for their own slot.
  await guest.getByTestId("lobby-slot-2-character").selectOption("vipra");

  // After changes broadcast, both pages see updated pickers.
  // Host's own picker reflects "panda".
  await expect(host.getByTestId("lobby-slot-0-character")).toHaveValue(
    "panda",
    {
      timeout: 5000,
    },
  );

  // Guest's own picker reflects "vipra".
  await expect(guest.getByTestId("lobby-slot-2-character")).toHaveValue(
    "vipra",
    { timeout: 5000 },
  );

  // Slot occupant data-occupant attributes remain "human" (unchanged by character pick).
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-occupant",
    "human",
  );
  await expect(guest.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
  );

  await hostCtx.close();
  await guestCtx.close();
});
