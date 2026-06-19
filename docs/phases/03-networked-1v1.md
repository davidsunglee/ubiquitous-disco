# Phase 3: Networked 1v1

## Playable Outcome

Two browser clients can join the same Colyseus room and play a complete 1v1 match with server authority, client-side prediction, server reconciliation, remote interpolation, and playable feel under simulated 80ms RTT.

## Functional Scope

- Online 1v1 Match Mode with two human Player Slots.
- Direct room create/join flow without Durable Object lobbies.
- Full Phase 2 match rules online: timer, scoring, Golden Goal, Strike, Stagger, Knockdown, and reset loop.
- Local client prediction for the controlled player and immediate ball response to local Strikes/collisions.
- Reconciliation of local player and ball against authoritative snapshots.
- Interpolation for remote player, ball, and other non-owned visible entities.
- Basic connection status UI and fail-closed disconnect behavior.
- Built-in dev network simulator with configurable latency, jitter, snapshot drop, and applicable reordering.

## Technical Scope

- Create `apps/server` as a Colyseus authoritative match server running on Bun.
- Create `packages/protocol` for explicit typed messages.
- Use Colyseus for room lifecycle, WebSocket transport, and connection management.
- Do not rely primarily on Colyseus Schema state sync for the game simulation.
- Define protocol messages for `PlayerInput`, `InputAck`, `WorldSnapshot`, room join/create, errors, and basic telemetry.
- Start protocol encoding as JSON/debuggable TypeScript objects.
- Clients send per-tick held button states and analog movement vectors at 30Hz with sequence numbers.
- Server simulates at 30Hz and sends authoritative snapshots at 15Hz.
- Remote interpolation starts at 100ms and is configurable in dev builds.
- Add local containerization for the server with a Docker/OCI image and health check.
- Add `pnpm dev:server` and update `pnpm dev` to launch the playable network stack.

## Starting Defaults

- Sim tick: 30Hz authoritative fixed step.
- Snapshot rate: 15Hz.
- Interpolation delay: 100ms.
- Phase 3 network acceptance: playable at simulated 80ms RTT with low loss.
- Correction policy: smooth small corrections and snap large corrections, with thresholds in dev-tunable config.
- Snapshot queue policy: prefer latest authoritative state and drop obsolete snapshots rather than growing queues.

## Out Of Scope

- Durable Objects, PartyServer, private lobby codes, anonymous identity, and reconnect coordination.
- 2v2, Practice Bots, bot-filled slots, and host-controlled lobbies.
- Public matchmaking, ranked play, accounts, D1/KV, and leaderboards.
- Binary protocol optimization.
- WebRTC DataChannels, WebTransport, server rewind, and advanced lag compensation.
- Live cloud deployment or Edgegap orchestration.

## Acceptance Criteria

- `pnpm dev` launches web and server for local networked play.
- Two browser tabs or devices can join the same direct 1v1 room.
- Both clients see the same score, timer, Bell Rings, Knockdowns, and match result.
- Local movement feels immediate because the local player is predicted.
- Local Strikes against the ball feel immediate because ball response is predicted and reconciled.
- Remote player motion is smooth through interpolation.
- The same demo remains playable with the built-in network simulator set to 80ms RTT and low loss.
- Server container builds locally and responds to a health check.
- Protocol contract tests validate client/server message compatibility.

## Human Acceptance Script

1. Run `pnpm dev`.
2. Open two browser clients.
3. Create or join a direct 1v1 room from both clients.
4. Play until at least one Bell Ring and one Knockdown occur.
5. Enable simulated 80ms RTT and repeat ball Strikes near the Bell.
6. Confirm the local player and ball response feel immediate and corrections are tolerable.
7. Disconnect one client and confirm the match fails closed with clear UI.
8. Build the server container and confirm the health check passes.

## Required Tests

- Protocol contract tests for all Phase 3 messages.
- Server room tests for input ordering, sequence acknowledgements, and authoritative snapshots.
- Replay tests comparing local and server sim outputs for the same input stream.
- Client prediction/reconciliation tests for discarded acknowledged inputs and replayed pending inputs.
- Playwright two-client smoke test for joining, moving, and observing shared score state.
- Network simulator tests for latency and dropped obsolete snapshots.
- Container health-check test or script.

## Agent Workflow

1. Refine protocol shape against the actual Phase 2 sim state.
2. Plan server-room work separately from client prediction work.
3. Implement a minimal authoritative room before adding smoothing and simulator controls.
4. Add protocol tests before expanding message fields.
5. Review that clients never send world state as authority.

## Handoff To Phase 4

Phase 4 should keep the Colyseus room as the authoritative match host and add Cloudflare Durable Object coordination around it. The direct room flow may remain as a dev path.
