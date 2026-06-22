/**
 * Local player profile — anonymous.
 *
 * playerId is per-TAB (sessionStorage): each browser tab/window is a distinct
 * lobby participant, so multiple tabs in one browser act as separate players. A
 * same-tab refresh keeps the same identity, so an in-tab reconnect reclaims the
 * same seat. Closing and reopening a tab yields a new identity — acceptable for
 * an ephemeral, account-less lobby.
 *
 * displayName is a shared, editable default (localStorage), overridable per tab
 * before joining.
 */

import type { LocalProfile } from "@bb/protocol";

const KEY_PLAYER_ID = "bb.playerId";
const KEY_DISPLAY_NAME = "bb.displayName";

/** Load (or initialise) the local player profile. */
export function loadProfile(): LocalProfile {
  let playerId = sessionStorage.getItem(KEY_PLAYER_ID);
  if (!playerId) {
    playerId = crypto.randomUUID();
    sessionStorage.setItem(KEY_PLAYER_ID, playerId);
  }
  const displayName = localStorage.getItem(KEY_DISPLAY_NAME) ?? "Player";
  return { playerId, displayName };
}

/** Persist an updated display name to localStorage. */
export function saveDisplayName(displayName: string): void {
  localStorage.setItem(KEY_DISPLAY_NAME, displayName.trim() || "Player");
}
