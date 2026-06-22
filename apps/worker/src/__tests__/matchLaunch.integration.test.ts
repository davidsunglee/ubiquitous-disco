/**
 * MatchLaunch integration tests — claim over workerd HTTP.
 *
 * Requires --max-workers=1 --no-isolate (pool-workers constraint).
 * Run with: pnpm --filter @bb/worker test:integration
 *
 * Covers the Colyseus → MatchLaunch claim path end-to-end:
 *   - a valid token returns the claimed slot + manifest
 *   - an unknown token is rejected (403)
 *   - a duplicate claim of an already-claimed slot is rejected (403)
 *   - a request missing the internal secret is rejected (401) by the entry gate
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

test("duplicate claim of an already-claimed slot is rejected with 403", async () => {
  const launchId = uniqueLaunchId();
  await seedLaunch(launchId, { tokA: 0 });
  const ctx = createExecutionContext();

  const first = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(first.status).toBe(200);

  const second = await worker.fetch(
    claimReq(launchId, { joinToken: "tokA" }, SECRET),
    env as unknown as MLEnv,
    ctx,
  );
  expect(second.status).toBe(403);

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
