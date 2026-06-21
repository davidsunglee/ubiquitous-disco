/**
 * Docker HEALTHCHECK script — fetches /healthz/live and exits 0 on 200, 1 otherwise.
 *
 * Usage (as defined in Dockerfile):
 *   HEALTHCHECK CMD bun run apps/server/scripts/healthcheck.ts || exit 1
 *
 * Can also be run directly:
 *   bun run apps/server/scripts/healthcheck.ts
 */

const PORT = process.env.PORT ?? "2567";
const url = `http://127.0.0.1:${PORT}/healthz/live`;

async function check(): Promise<number> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (response.ok) return 0;
    console.error(`[healthcheck] ${url} returned HTTP ${response.status}`);
  } catch (err) {
    console.error(`[healthcheck] fetch failed: ${err}`);
  }
  return 1;
}

check().then((code) => process.exit(code));

export {};
