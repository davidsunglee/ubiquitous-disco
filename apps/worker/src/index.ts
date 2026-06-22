/**
 * Worker entry point.
 *
 * Routes WebSocket connections and HTTP requests to the PrivateLobby
 * Durable Object by lobby code via routePartykitRequest.
 *
 * The path pattern is /parties/private-lobby/:code (kebab-case of the binding
 * name "PrivateLobby" → "private-lobby" as per PartyServer routing convention).
 *
 * Phase 5 additions: match-launch routing + shared-secret gate.
 */

import { routePartykitRequest } from "partyserver";

export { PrivateLobby } from "./PrivateLobby";

export interface Env {
  PrivateLobby: DurableObjectNamespace;
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

    const routed = await routePartykitRequest(
      req,
      env as unknown as Record<string, unknown>,
    );
    return routed ?? new Response("Not found", { status: 404 });
  },
};
