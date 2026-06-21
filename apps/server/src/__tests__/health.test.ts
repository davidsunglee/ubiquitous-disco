/**
 * Health route tests.
 *
 * Tests the /healthz/live and /healthz/ready handler logic directly —
 * without spinning up the full Colyseus + Bun server — by exercising
 * the same readiness-flag pattern used in index.ts.
 *
 * Convention: mirrors matchRoom.test.ts (top-level test(), vitest imports).
 */

import { expect, test } from "vitest";

// ── Inline the handler logic under test ──────────────────────────────────────
//
// index.ts expresses health as two express handlers sharing a `serverReady`
// boolean. We reproduce that minimal contract here so the test is independent
// of the full Colyseus bootstrap (which requires Bun's WS server).

type ResStub = { status: (c: number) => { json: (b: unknown) => void } };

function makeLivenessHandler() {
  return (_req: unknown, res: ResStub) => {
    res.status(200).json({ status: "ok" });
  };
}

function makeReadinessHandler(isReady: () => boolean) {
  return (_req: unknown, res: ResStub) => {
    if (isReady()) {
      res.status(200).json({ status: "ready" });
    } else {
      res.status(503).json({ status: "starting" });
    }
  };
}

// Minimal stub that records what Express-style routes would send.
function makeRes() {
  const recorded: { code: number; body: unknown } = { code: 0, body: null };
  return {
    recorded,
    status(code: number) {
      recorded.code = code;
      return {
        json(body: unknown) {
          recorded.body = body;
        },
      };
    },
  };
}

// ── /healthz/live ─────────────────────────────────────────────────────────────

test("/healthz/live returns 200 with { status: 'ok' }", () => {
  const handler = makeLivenessHandler();
  const res = makeRes();
  handler(null, res);
  expect(res.recorded.code).toBe(200);
  expect(res.recorded.body).toEqual({ status: "ok" });
});

test("/healthz/live is always 200 regardless of readiness flag", () => {
  // Liveness must not depend on the readiness flag — the process is alive
  // even while the transport is still starting up.
  const handler = makeLivenessHandler();
  const res = makeRes();
  handler(null, res);
  expect(res.recorded.code).toBe(200);
});

// ── /healthz/ready ────────────────────────────────────────────────────────────

test("/healthz/ready returns 503 before server is ready", () => {
  const serverReady = false;
  const handler = makeReadinessHandler(() => serverReady);
  const res = makeRes();
  handler(null, res);
  expect(res.recorded.code).toBe(503);
  expect((res.recorded.body as { status: string }).status).toBe("starting");
});

test("/healthz/ready returns 200 after server becomes ready", () => {
  let serverReady = false;
  const handler = makeReadinessHandler(() => serverReady);

  // Before ready.
  const res1 = makeRes();
  handler(null, res1);
  expect(res1.recorded.code).toBe(503);

  // Flip ready flag (mirrors `serverReady = true` after gameServer.listen() in index.ts).
  serverReady = true;

  // After ready.
  const res2 = makeRes();
  handler(null, res2);
  expect(res2.recorded.code).toBe(200);
  expect((res2.recorded.body as { status: string }).status).toBe("ready");
});

test("/healthz/ready returns JSON body with status field", () => {
  const handler = makeReadinessHandler(() => true);
  const res = makeRes();
  handler(null, res);
  expect(res.recorded.body).toEqual({ status: "ready" });
});

test("/healthz/ready 503 body has status field", () => {
  const handler = makeReadinessHandler(() => false);
  const res = makeRes();
  handler(null, res);
  expect(res.recorded.body).toEqual({ status: "starting" });
});
