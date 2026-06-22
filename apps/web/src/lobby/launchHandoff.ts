/**
 * Launch handoff — carries the MatchLaunch payload (launchId, playerSlotId,
 * joinToken) from the lobby page to the Phaser match page across the navigation.
 *
 * Stored in sessionStorage (per-tab) so it survives the page reload that reveals
 * the match, and so each tab carries its own launch. GameScene reads it on
 * create() and, if present, joins Colyseus via the launch instead of the
 * create/join overlay. The token is consumed (cleared) once read.
 */

import type { MatchLaunch } from "@bb/protocol";

const KEY = "bb.launch";

/** Persist the launch payload and return the match URL to navigate to. */
export function saveLaunch(launch: MatchLaunch): void {
  sessionStorage.setItem(KEY, JSON.stringify(launch));
}

/** Read the launch payload (or null if none). Does not clear it. */
export function peekLaunch(): MatchLaunch | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MatchLaunch;
  } catch {
    return null;
  }
}

/** Read and clear the launch payload (single-use). */
export function takeLaunch(): MatchLaunch | null {
  const launch = peekLaunch();
  if (launch) sessionStorage.removeItem(KEY);
  return launch;
}
