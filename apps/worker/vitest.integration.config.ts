/**
 * Vitest config for integration tests (*.integration.test.ts).
 *
 * Used by: pnpm test:integration → vitest run --config vitest.integration.config.ts
 *
 * WebSocket-in-DO constraints:
 *   --max-workers=1   Single worker to avoid cross-test WebSocket teardown races.
 *   --no-isolate      Reuse the same module registry across tests in one file.
 */

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    name: "worker-integration",
    include: ["src/**/*.integration.test.ts"],
  },
});
