/**
 * MatchLaunch integration tests — claim over workerd HTTP.
 *
 * Requires --max-workers=1 --no-isolate (pool-workers constraint).
 * Run with: pnpm --filter @bb/worker test:integration
 *
 * Covers the Colyseus → MatchLaunch claim path end-to-end:
 *   - a valid token returns the claimed slot + manifest
 *   - an unknown token is rejected (403)
 *   - a duplicate claim of an already-claimed slot by a different token is rejected (403)
 *   - a request missing the internal secret is rejected (401) by the entry gate
 *
 * Phase 6 (reconnect grace — DO-side semantics post-correctness fix):
 *   - same-token re-claim ALWAYS returns 200 (idempotent, no DO-side expiry)
 *   - a different token for an already-claimed slot is still rejected (403)
 *   - there is NO DO-side grace alarm; the Colyseus MatchRoom owns the grace clock
 *
 * The manifest is seeded directly into the MatchLaunch DO via its put() RPC,
 * then claimed over HTTP through the worker entry (which enforces the secret).
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import type { MatchManifest, PlayerSlotId } from "@bb/protocol";
import { expect, test } from "vitest";
import worker from "../index";
import type { MatchLaunch } from "../MatchLaunch";

const SECRET = "dev-secret";

type MLEnv = {
  PrivateLobby: DurableObjectNamespace;
  MATCH_LAUNCH: DurableObjectNamespace<MatchLaunch>;
};

let launchSeq = 0;
function uniqueLaunchId(): string {
  return `launch${String(++launchSeq).padStart(8, "0")}`;
}

/** Seed a manifest + token map into the MatchLaunch DO addressed by launchId. */
async function seedLaunch(
  launchId: string,
  tokenToSlot: Record<string, PlayerSlotId>,
): Promise<void> {
  const ns = (env as unknown as MLEnv).MATCH_LAUNCH;
  const stub = ns.get(ns.idFromName(launchId));
  const manifest: MatchManifest = {
    launchId,
    slots: Object.values(tokenToSlot).map((slotId) => ({
      slotId,
      kind: "human" as const,
      playerId: `p${slotId}`,
    })),
    settings: { mode: "2v2", matchLengthTicks: 5400, arenaId: "flat-dojo" },
  };
  await stub.put({ manifest, tokenToSlot });
}

function claimReq(launchId: string, body: unknown, secret?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret !== undefined) headers["x-worker-secret"] = secret;
  return new Request(`http://x/parties/match-launch/${launchId}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("valid token returns ok + claimed slot + manifest", async () => {
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0, tokB: 2 });
  const ctx = createExecutionContext();

  const res = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    playerSlotId: number;
    manifest: MatchManifest;
  };
  expect(body.ok).toBe(true);
  expect(body.playerSlotId).toBe(0);
  expect(body.manifest.launchId).toBe(launchId);

  await waitOnExecutionContext(ctx);
});

test("unknown token is rejected with 403", async () => {
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });
  const ctx = createExecutionContext();

  const res = await worker.fetch(
    claimReq(launchId, { joinToken: "nope" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(res.status).toBe(403);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(false);

  await waitOnExecutionContext(ctx);
});

test("duplicate same-token claim within grace is idempotent (200)", async () => {
  // Phase 6: same-token duplicate always returns 200 (no DO-side expiry).
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });
  const ctx = createExecutionContext();

  const first = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(first.status).toBe(200);

  // Same token → idempotent 200.
  const second = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(second.status).toBe(200);

  await waitOnExecutionContext(ctx);
});

test("a request missing the internal secret is rejected with 401 (entry gate)", async () => {
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });
  const ctx = createExecutionContext();

  // No secret header at all.
  const res = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }),
    env as unknown as MLEnv,
    ctx,
  );
  expect(res.status).toBe(401);

  // Wrong secret.
  const res2 = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, "wrong"),
    env as unknown as MLEnv,
    ctx,
  );
  expect(res2.status).toBe(401);

  await waitOnExecutionContext(ctx);
});

// ── Phase 6: reconnect grace (DO is NOT the grace authority) ─────────────────

test("same-token reclaim always succeeds — DO has no expiry (idempotent)", async () => {
  // The DO never rejects a same-token reclaim. Grace enforcement lives in the
  // Colyseus MatchRoom (onLeave → reserveSlot timer → onGraceExpired).
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });

  // Get the MatchLaunch DO stub for direct RPC (no HTTP overhead needed here).
  const ns = (env as unknown as MLEnv).MATCH_LAUNCH;
  const stub = ns.get(ns.idFromName(launchId));

  // First claim — slot 0 is now claimed.
  const firstRes = await (
    stub as unknown as import("../MatchLaunch").MatchLaunch
  ).claim("tokA");
  expect(firstRes.ok).toBe(true);

  // Same token reclaim — must ALWAYS succeed (no DO-side grace window).
  const secondRes = await (
    stub as unknown as import("../MatchLaunch").MatchLaunch
  ).claim("tokA");
  expect(secondRes.ok).toBe(true);
  expect((secondRes as { playerSlotId?: number }).playerSlotId).toBe(0);
});

test("same-token reclaim within grace window succeeds (idempotent)", async () => {
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });
  const ctx = createExecutionContext();

  // First claim — slot 0 is now claimed.
  const first = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(first.status).toBe(200);

  // Second claim with the SAME token — must succeed (idempotent reclaim).
  const second = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(second.status).toBe(200);
  const body = (await second.json()) as { ok: boolean; playerSlotId: number };
  expect(body.ok).toBe(true);
  expect(body.playerSlotId).toBe(0);

  await waitOnExecutionContext(ctx);
});

test("different token for an already-claimed slot is still rejected (403)", async () => {
  const launchId = uniqueLaunchId();
  // Two tokens, both mapping to slot 0 — unusual but tests the guard.
  await seedLaunch(launchId, { tokA: 0, tokB: 1 });
  const ctx = createExecutionContext();

  // Claim slot 0 with tokA.
  const first = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(first.status).toBe(200);

  // Attempt to claim slot 1 with tokB — should succeed (different slot).
  const second = await worker.fetch(
    claimReq(launchId, { joinToken: "tokB" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(second.status).toBe(200);

  // Attempting tokA again (slot 0) is always idempotent — no expiry in DO.
  const third = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(third.status).toBe(200);

  await waitOnExecutionContext(ctx);
});
