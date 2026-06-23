# Bell Brawl Technical Specifications

These specifications define six playable vertical slices for building Bell Brawl. Each phase should be refined by an agent before implementation, then planned into concrete tasks, implemented with tests, reviewed, and iterated until the playable outcome is clean.

## Source Inputs

- `docs/brainstorm/01 bellbrawl - spec and architecture.md`
- `docs/brainstorm/02 bellbrawl - architecture verification.md`
- [`CONTEXT.md`](../../CONTEXT.md) — domain vocabulary
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — stack, monorepo shape, invariants, deferred scope
- [`AGENTS.md`](../../AGENTS.md) — standard commands and per-phase workflow
- [`docs/adr/0001-server-authoritative-colyseus-with-do-coordination.md`](../adr/0001-server-authoritative-colyseus-with-do-coordination.md)
- [`docs/adr/0002-deterministic-rapier-shared-simulation-wrapper.md`](../adr/0002-deterministic-rapier-shared-simulation-wrapper.md)

## Canonical Phase Sequence

| Phase | Spec | Playable outcome |
|---|---|---|
| 1 | [Local Feel Sandbox](./01-local-feel-sandbox.md) | One player, one ball, Flat Dojo, elevated Bells, core movement and Strike feel. |
| 2 | [Local Complete 1v1 Match](./02-local-complete-1v1-match.md) | Two local humans can complete a timed 1v1 match with combat and Golden Goal. |
| 3 | [Networked 1v1](./03-networked-1v1.md) | Two browser clients can play 1v1 through a Colyseus authoritative room. |
| 4 | [Private 2v2 Lobbies And Bot Fill](./04-private-2v2-lobbies-bot-fill.md) | Private lobbies coordinate 2v2 slots, bot fill, and reconnect. |
| 5 | [Roster, Arenas, And Balance](./05-roster-arenas-balance.md) | Six placeholder characters, three arenas, Specials, and balance telemetry are playable. |
| 6 | [Production Hardening And Mobile Readiness](./06-production-hardening-mobile-readiness.md) | The web game is hardened for mobile, deployment, network stress, and prototype presentation. |

The [monorepo](../../ARCHITECTURE.md#monorepo-shape) is built up lazily by phase:
Phase 1 creates `apps/web`, `packages/sim`, and the root tooling; Phase 3 creates
`apps/server` and `packages/protocol`; Phase 4 creates `apps/worker`.

## Project-Wide References

The following are durable, project-wide facts that apply to every phase. They live
outside these specs so they stay authoritative as the slices evolve:

- **Technology stack, monorepo shape, design invariants, tunable defaults, and deferred work:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
- **Standard commands (`pnpm verify`, etc.) and the per-phase agent workflow:** [`AGENTS.md`](../../AGENTS.md)
- **Domain vocabulary:** [`CONTEXT.md`](../../CONTEXT.md)

Tuning numbers in these specs are starting defaults, not immutable truths. Every phase
must end with a playable demo command and a human acceptance script.
