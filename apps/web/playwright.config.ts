import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: [
    {
      command: process.env.CI
        ? "vite preview --port 4173"
        : "vite dev --port 5180",
      url: process.env.CI ? "http://localhost:4173" : "http://127.0.0.1:5180",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Authoritative Colyseus server (Bun) for the two-client net-*.spec.ts
      // specs. Polls the liveness route until the server is up. Requires bun on
      // PATH (CI installs it via oven-sh/setup-bun).
      command: "pnpm --filter @bb/server start",
      url: "http://127.0.0.1:2567/healthz/live",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Cloudflare Worker (via Wrangler dev) for lobby presence tests.
      // Polls /healthz (returns 200 "ok") so Playwright can confirm the worker
      // is listening before running lobby e2e tests.
      command: "pnpm --filter @bb/worker dev",
      url: "http://127.0.0.1:8787/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  use: {
    baseURL: process.env.CI ? "http://localhost:4173" : "http://127.0.0.1:5180",
  },
});
