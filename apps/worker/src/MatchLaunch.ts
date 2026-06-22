/**
 * MatchLaunch Durable Object — via PartyServer, addressed by an opaque launchId.
 *
 * Holds ONE immutable launch manifest + its claim state. Written once at
 * PrivateLobby.lock() time via DO→DO RPC (put), then read by the Colyseus
 * MatchRoom over authenticated HTTP (onRequest → claim) once per human join.
 *
 * Persistence (Deviation #3 decision): this DO MUST persist its manifest +
 * claim state to ctx.storage (SQLite-backed). Unlike PrivateLobby — which is
 * kept resident by its live WebSocket connections — nothing keeps MatchLaunch
 * warm between the lock() write and the later claim() reads, so in-memory state
 * would be lost on eviction. The manifest is the source of truth for who may
 * claim each human Player Slot (and for idempotent same-token reclaim).
 *
 * Reconnect grace (post-Phase-6 correctness fix):
 * Grace is owned entirely by the Colyseus MatchRoom, NOT this DO. The DO
 * cannot observe player disconnects — only the Colyseus server sees them via
 * onLeave(). The MatchRoom's onLeave() → reserveSlot() path starts a wall-clock
 * timer (DEFAULT_RECONNECT_CONFIG.reconnectGraceMs) anchored at the actual
 * disconnect, and onGraceExpired() fail-closes after the window.
 *
 * This DO's responsibility is narrower:
 *   1. Token validity — unknown token → reject.
 *   2. Anti-hijack — a DIFFERENT token may not claim an already-claimed slot.
 *   3. Idempotent reclaim — the SAME token may reclaim its slot at any time
 *      (the grace clock is the MatchRoom's concern, not ours).
 *
 * No alarm is set. No per-slot expiry state is tracked. ClaimedSlotState holds
 * only the token binding needed for the anti-hijack check.
 */

import type { ClaimResponse, MatchManifest, PlayerSlotId } from "@bb/protocol";
import { Server } from "partyserver";

/** Per-claimed-slot state within StoredLaunch. */
interface ClaimedSlotState {
  /** The joinToken that performed the original claim (single-use on different tokens). */
  token: string;
}

/** The single record persisted under STORAGE_KEY. */
interface StoredLaunch {
  manifest: MatchManifest;
  /** joinToken → slot id. */
  tokenToSlot: Record<string, PlayerSlotId>;
  /**
   * Slot ids already claimed, keyed by slot id.
   * Stores only the token binding needed for the anti-hijack check.
   */
  claimedSlots: Partial<Record<PlayerSlotId, ClaimedSlotState>>;
}

const STORAGE_KEY = "launch";

// MatchLaunch has no env-binding dependencies of its own.
type MatchLaunchEnv = Record<string, never>;

export class MatchLaunch extends Server<MatchLaunchEnv> {
  /**
   * Persist the immutable manifest + token map. Called once at lock() time via
   * DO→DO RPC.
   */
  async put(data: {
    manifest: MatchManifest;
    tokenToSlot: Record<string, PlayerSlotId>;
  }): Promise<void> {
    const stored: StoredLaunch = {
      manifest: data.manifest,
      tokenToSlot: data.tokenToSlot,
      claimedSlots: {},
    };
    await this.ctx.storage.put(STORAGE_KEY, stored);
  }

  /**
   * HTTP entry — Colyseus POSTs { joinToken } here. The worker entry gates this
   * route on the shared secret, so unauthenticated requests never reach here.
   */
  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: { joinToken?: unknown };
    try {
      body = (await request.json()) as { joinToken?: unknown };
    } catch {
      return Response.json({ ok: false } satisfies ClaimResponse, {
        status: 400,
      });
    }

    if (typeof body.joinToken !== "string") {
      return Response.json({ ok: false } satisfies ClaimResponse, {
        status: 400,
      });
    }

    const result = await this.claim(body.joinToken);
    return Response.json(result, { status: result.ok ? 200 : 403 });
  }

  /**
   * Validate a join token and claim its slot.
   *
   * Three rules — in order:
   *   1. Unknown token → { ok: false } (403).
   *   2. A DIFFERENT token attempting to claim an already-claimed slot → { ok: false } (403).
   *   3. Same token (first claim or idempotent reclaim) → { ok: true, playerSlotId, manifest }.
   *
   * There is NO expiry check here. Grace lives in the Colyseus MatchRoom; this
   * DO only enforces token identity + anti-hijack.
   */
  async claim(joinToken: string): Promise<ClaimResponse> {
    const stored = await this.ctx.storage.get<StoredLaunch>(STORAGE_KEY);
    if (!stored) return { ok: false };

    const slot = stored.tokenToSlot[joinToken];
    if (slot === undefined) return { ok: false };

    const existing = stored.claimedSlots[slot];

    if (existing) {
      // Slot is already claimed — check if this is the same token (reclaim).
      if (existing.token !== joinToken) {
        // A different token is trying to claim an occupied slot → reject.
        return { ok: false };
      }
      // Same token → idempotent reclaim; always succeeds regardless of time.
      return { ok: true, playerSlotId: slot, manifest: stored.manifest };
    }

    // First claim for this slot — record the token binding.
    stored.claimedSlots[slot] = { token: joinToken };
    await this.ctx.storage.put(STORAGE_KEY, stored);

    return { ok: true, playerSlotId: slot, manifest: stored.manifest };
  }
}
