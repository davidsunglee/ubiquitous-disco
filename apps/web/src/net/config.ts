import { DEFAULT_CONFIG } from "@bb/sim";

// Vite injects import.meta.env at build time. The cast below is needed because
// the web tsconfig doesn't include vite/client types (to avoid forcing DOM
// changes on server-side packages).
type ViteEnv = { VITE_SERVER_URL?: string };
export const SERVER_URL =
  (import.meta as unknown as { env: ViteEnv }).env.VITE_SERVER_URL ??
  "ws://127.0.0.1:2567";
export const FIXED_STEP_MS = 1000 / DEFAULT_CONFIG.tickHz; // 33.33ms
export const SNAPSHOT_EVERY = 2; // 30Hz ticks → 15Hz snapshots
export const INTERP_DELAY_MS = 100;
export const INTERP_DELAY_TICKS = Math.round(INTERP_DELAY_MS / FIXED_STEP_MS); // ≈3
