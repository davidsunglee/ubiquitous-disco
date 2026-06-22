/**
 * Lobby match-mode picker e2e test.
 *
 * Verifies that:
 *   - The host sees a lobby-mode <select> defaulting to "2v2".
 *   - Switching to "1v1" dims slots 1 and 3 (data-in-mode="false") and keeps
 *     slots 0 and 2 active (data-in-mode="true").
 *   - In 1v1 mode with both required slots filled (host + guest), the host
 *     can start the match (Start button becomes enabled).
 *   - Guests do not see the lobby-mode control.
 *   - The mode select syncs back from server state on reconnect / late join.
 *
 * Requires:
 *   - Vite dev server at http://127.0.0.1:5180 (or 4173 in CI)
 *   - Cloudflare Worker at http://127.0.0.1:8787
 *
 * Skip with SKIP_NET_E2E=1 when the worker is unavailable.
 */

import { expect, test } from "@playwright/test";

const SKIP = !!process.env.SKIP_NET_E2E;

test("host sees lobby-mode select defaulting to 2v2", async ({ browser }) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  await expect(host.getByTestId("lobby-slots")).toBeVisible({ timeout: 8000 });

  // The mode picker must be present and default to "2v2".
  const modeSel = host.getByTestId("lobby-mode");
  await expect(modeSel).toBeVisible({ timeout: 5000 });
  await expect(modeSel).toHaveValue("2v2");

  await ctx.close();
});

test("switching to 1v1 dims slots 1 and 3, keeps 0 and 2 active", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const ctx = await browser.newContext();
  const host = await ctx.newPage();

  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();

  await expect(host.getByTestId("lobby-slot-0")).toBeVisible({ timeout: 8000 });

  // In 2v2 (default) all four slots are in-mode.
  for (const slotId of [0, 1, 2, 3]) {
    await expect(host.getByTestId(`lobby-slot-${slotId}`)).toHaveAttribute(
      "data-in-mode",
      "true",
    );
  }

  // Switch to 1v1.
  await host.getByTestId("lobby-mode").selectOption("1v1");

  // Slots 0 and 2 must be in-mode; slots 1 and 3 must be out-of-mode.
  await expect(host.getByTestId("lobby-slot-0")).toHaveAttribute(
    "data-in-mode",
    "true",
    { timeout: 5000 },
  );
  await expect(host.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-in-mode",
    "true",
    { timeout: 5000 },
  );
  await expect(host.getByTestId("lobby-slot-1")).toHaveAttribute(
    "data-in-mode",
    "false",
    { timeout: 5000 },
  );
  await expect(host.getByTestId("lobby-slot-3")).toHaveAttribute(
    "data-in-mode",
    "false",
    { timeout: 5000 },
  );

  // Out-of-mode slots must not show a "+ Bot" button.
  await expect(host.getByTestId("lobby-slot-1-bot")).not.toBeVisible();
  await expect(host.getByTestId("lobby-slot-3-bot")).not.toBeVisible();

  await ctx.close();
});

test("guest does not see the lobby-mode control", async ({ browser }) => {
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

  // Guest must NOT see the mode picker (host-only control).
  await expect(guest.getByTestId("lobby-mode")).not.toBeVisible();

  // Host does see it.
  await expect(host.getByTestId("lobby-mode")).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});

test("host switches to 1v1, guest joins, start button becomes enabled", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // Host creates lobby and switches to 1v1.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();

  await host.getByTestId("lobby-mode").selectOption("1v1");

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

  // In 1v1 mode slots 0 (host) and 2 (guest) are the only required slots —
  // the Start button must now be enabled.
  const startBtn = host.getByTestId("lobby-start-match");
  await expect(startBtn).toBeEnabled({ timeout: 5000 });

  await hostCtx.close();
  await guestCtx.close();
});

test("mode select syncs to server state on incoming LobbyState", async ({
  browser,
}) => {
  test.skip(SKIP, "SKIP_NET_E2E set — worker not running");

  const hostCtx = await browser.newContext();
  const guest2Ctx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest2 = await guest2Ctx.newPage();

  // Host creates lobby and switches to 1v1.
  await host.goto("/#lobby");
  await host.getByTestId("lobby-name").fill("Alice");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("lobby-code")).toBeVisible({ timeout: 8000 });
  const code = (await host.getByTestId("lobby-code").innerText()).trim();

  await host.getByTestId("lobby-mode").selectOption("1v1");

  // A second host tab joins the same lobby code — it should see 1v1 in the mode
  // picker once the server broadcasts its current LobbyState.
  await guest2.goto("/#lobby");
  await guest2.getByTestId("lobby-name").fill("Alice");
  await guest2.getByTestId("lobby-join-code").fill(code);
  await guest2.getByTestId("lobby-join").click();

  // guest2 lands in slot 2 as a non-host so the mode select is hidden — but
  // the slot data-in-mode attributes still reflect the server's mode setting.
  await expect(guest2.getByTestId("lobby-slot-2")).toHaveAttribute(
    "data-occupant",
    "human",
    { timeout: 8000 },
  );
  await expect(guest2.getByTestId("lobby-slot-1")).toHaveAttribute(
    "data-in-mode",
    "false",
    { timeout: 5000 },
  );
  await expect(guest2.getByTestId("lobby-slot-3")).toHaveAttribute(
    "data-in-mode",
    "false",
    { timeout: 5000 },
  );

  await hostCtx.close();
  await guest2Ctx.close();
});
