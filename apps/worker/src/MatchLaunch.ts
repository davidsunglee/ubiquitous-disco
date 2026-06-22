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
 * claim each human Player Slot (and, in Phase 6, slot reclaim during grace).
 */

import type { ClaimResponse, MatchManifest, PlayerSlotId } from "@bb/protocol";
import { Server } from "partyserver";

/** The single record persisted under STORAGE_KEY. */
interface StoredLaunch {
  manifest: MatchManifest;
  /** joinToken → slot id. Single-use in Phase 5 (consumed on first claim). */
  tokenToSlot: Record<string, PlayerSlotId>;
  /** Slot ids already claimed — prevents duplicate-token reuse / double-claim. */
  claimedSlots: PlayerSlotId[];
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
      claimedSlots: [],
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
   * Phase 5: a token is single-use — the first claim succeeds; any unknown or
   * already-claimed (duplicate) token is rejected. Phase 6 layers
   * idempotent reclaim-within-grace on top of this method.
   */
  async claim(joinToken: string): Promise<ClaimResponse> {
    const stored = await this.ctx.storage.get<StoredLaunch>(STORAGE_KEY);
    if (!stored) return { ok: false };

    const slot = stored.tokenToSlot[joinToken];
    if (slot === undefined) return { ok: false };

    if (stored.claimedSlots.includes(slot)) {
      return { ok: false };
    }

    stored.claimedSlots.push(slot);
    await this.ctx.storage.put(STORAGE_KEY, stored);
    return { ok: true, playerSlotId: slot, manifest: stored.manifest };
  }
}
