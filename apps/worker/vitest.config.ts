import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    name: "worker",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Default (unit) test run excludes integration tests.
    // The test:integration script overrides include/exclude to target only
    // *.integration.test.ts with --max-workers=1 --no-isolate.
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
  },
});
