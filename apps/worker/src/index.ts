/**
 * Worker entry point.
 *
 * Routes WebSocket connections and HTTP requests to the PrivateLobby
 * Durable Object by lobby code via routePartykitRequest.
 *
 * The path pattern is /parties/private-lobby/:code (kebab-case of the binding
 * name "PrivateLobby" → "private-lobby" as per PartyServer routing convention).
 *
 * Phase 5: also routes /parties/match-launch/:launchId (binding "MATCH_LAUNCH"
 * → "match-launch") to the MatchLaunch DO. That namespace is gated on a shared
 * secret HERE, before routing, so unauthenticated requests never reach the DO.
 */

import { routePartykitRequest } from "partyserver";

export { MatchLaunch } from "./MatchLaunch";
export { PrivateLobby } from "./PrivateLobby";

export interface Env {
  PrivateLobby: DurableObjectNamespace;
  MATCH_LAUNCH: DurableObjectNamespace;
  WORKER_INTERNAL_SECRET?: string;
}

export default {
  async fetch(
    req: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url);

    // Health check route — used by Playwright to poll until the worker is up.
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    // Shared-secret gate for the match-launch namespace. The Colyseus server
    // (the only legitimate caller) sends the x-worker-secret header. Gate here,
    // before routing, so unauthenticated requests never reach the DO.
    if (url.pathname.startsWith("/parties/match-launch/")) {
      const expected = env.WORKER_INTERNAL_SECRET ?? "dev-secret";
      if (req.headers.get("x-worker-secret") !== expected) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const routed = await routePartykitRequest(
      req,
      env as unknown as Record<string, unknown>,
    );
    return routed ?? new Response("Not found", { status: 404 });
  },
};
