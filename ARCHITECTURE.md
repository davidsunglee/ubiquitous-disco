# Bell Brawl Architecture

Durable, project-wide technical facts for Bell Brawl. This file is the high-level
"what"; the [Architecture Decision Records](./docs/adr/) hold the deeper "why" for
individual decisions. Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md);
contributor and agent workflow lives in [`AGENTS.md`](./AGENTS.md).

## Technology Stack

- **Language:** TypeScript.
- **Package management and scripts:** PNPM.
- **Authoritative server runtime:** Bun.
- **Client stack:** Phaser + Vite + TypeScript, without React initially.
- **Match host:** Colyseus on Bun (see [ADR 0001](./docs/adr/0001-server-authoritative-colyseus-with-do-coordination.md)).
- **Coordination layer:** Cloudflare Workers and Durable Objects via PartyServer/PartySocket (see [ADR 0001](./docs/adr/0001-server-authoritative-colyseus-with-do-coordination.md)).
- **Transport:** WebSockets.
- **Physics:** deterministic Rapier wrapped by `packages/sim` (see [ADR 0002](./docs/adr/0002-deterministic-rapier-shared-simulation-wrapper.md)).
- **Players:** kinematic game actors using Rapier-backed collision queries.
- **Ball and arena collision:** Rapier-backed through the sim wrapper.
- **Tests:** Vitest, deterministic replay tests, protocol contract tests, and Playwright smoke tests.
- **Lint/format:** Biome plus `tsc --noEmit`.
- **CI:** runs the `pnpm verify` aggregate (see [`AGENTS.md`](./AGENTS.md)).

## Monorepo Shape

```txt
apps/
  web/       Phaser/Vite browser client
  server/    Colyseus authoritative match server on Bun
  worker/    Cloudflare Worker/Durable Object coordination layer
packages/
  sim/       Host-agnostic authoritative simulation and deterministic replay support
  protocol/  Typed input, snapshot, lobby, and telemetry messages
```

Directories are created lazily as phases need them.

## Design Invariants

These hold across every phase and should not be changed casually:

- Bell Brawl is original work. Kung Fu Kickball is a reference game only — never a source of copied assets, code, names, or layouts.
- The authoritative simulation is server-authoritative.
- The sim uses abstract world units, not Phaser pixels.
- Sim coordinates are X right, Y up, with gravity in negative Y.
- The simulation is a fixed-timestep deterministic loop.
- Gameplay randomness must use seeded deterministic RNG.
- Tuning values are typed sim configs, not scattered magic numbers.

## Tunable Defaults

These are starting points, not immutable truths. Treat the numbers in the
phase specs the same way.

- Authoritative simulation tick rate: 30Hz.
- Client input cadence: per-tick held button states and analog movement vectors at 30Hz.
- Networked snapshot rate: starts at 15Hz.
- Remote interpolation delay: starts at 100ms, configurable in dev builds.

## Deferred Work

Explicitly out of scope for the current slice sequence:

- Ranked matchmaking, MMR, accounts, and leaderboards.
- Public matchmaking queues beyond private lobbies.
- WebRTC DataChannel or WebTransport transport upgrades.
- Full native app delivery and app-store packaging.
- Player-facing spectator mode.
- Server rewind or full lag compensation.
- Production art, final character identities, and final branding.
