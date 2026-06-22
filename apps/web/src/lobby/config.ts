/**
 * Lobby client configuration.
 *
 * Mirrors apps/web/src/net/config.ts — reads VITE_WORKER_URL from the build
 * environment and falls back to the Wrangler dev default.
 */

type ViteEnv = { VITE_WORKER_URL?: string };

export const WORKER_URL =
  (import.meta as unknown as { env: ViteEnv }).env.VITE_WORKER_URL ??
  "http://127.0.0.1:8787";
