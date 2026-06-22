/**
 * lobbyClient — thin HTTP client the MatchRoom uses to validate a join against
 * the worker's MatchLaunch DO.
 *
 * Reads WORKER_URL (default http://127.0.0.1:8787 — the Wrangler dev address)
 * and WORKER_INTERNAL_SECRET (default "dev-secret"), mirroring the env-or-default
 * pattern in apps/web/src/net/config.ts. POSTs to
 * /parties/match-launch/:launchId with the shared-secret header.
 *
 * The claim call is once-per-join (≤4 humans/match, plus reconnects in Phase 6),
 * never per tick — ADR 0001 compliant.
 */

import type { ClaimResponse } from "@bb/protocol";

const WORKER_URL = process.env.WORKER_URL ?? "http://127.0.0.1:8787";
const SECRET = process.env.WORKER_INTERNAL_SECRET ?? "dev-secret";

/**
 * Validate a join token against the MatchLaunch DO addressed by launchId.
 * Returns `{ ok: false }` on any non-OK response or network/parse error so
 * callers can fail closed.
 */
export async function claim(
  launchId: string,
  joinToken: string,
): Promise<ClaimResponse> {
  try {
    const res = await fetch(`${WORKER_URL}/parties/match-launch/${launchId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": SECRET,
      },
      body: JSON.stringify({ joinToken }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as ClaimResponse;
  } catch {
    return { ok: false };
  }
}
