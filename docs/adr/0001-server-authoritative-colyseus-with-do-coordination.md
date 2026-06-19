# Server-Authoritative Colyseus With Durable Object Coordination

Bell Brawl will use a server-authoritative match model with Colyseus running on Bun as the authoritative match host, while Cloudflare Durable Objects via PartyServer/PartySocket handle private lobbies, presence, slot coordination, and reconnect coordination. This keeps the match loop region-selectable and avoids Durable Object location pinning for latency-sensitive play, while still using Durable Objects for the shared-state coordination work they are best at.

## Considered Options

- Durable Object as authoritative match room: attractive for operations, but risky for cross-region latency because objects are pinned to one location.
- Peer-to-peer or lockstep rollback: rejected because four-player browser physics raises determinism, desync, and anti-cheat risk.
- Colyseus authoritative rooms with Durable Object coordination: accepted because it gives explicit region control, proven room lifecycle support, and clean coordination boundaries.

## Consequences

- The simulation must be host-agnostic enough that future Durable Object room experiments remain possible.
- Clients send inputs, not world state.
- Match networking must support prediction, reconciliation, and interpolation because the server is authoritative.
