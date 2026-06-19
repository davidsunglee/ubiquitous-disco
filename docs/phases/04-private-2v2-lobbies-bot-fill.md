# Phase 4: Private 2v2 Lobbies And Bot Fill

## Playable Outcome

A host can create a private lobby code, humans can join Player Slots, empty 2v2 slots can be filled by server-side Practice Bots, teams can be assigned, and the lobby can launch a Colyseus-hosted 2v2 match with basic reconnect support.

## Functional Scope

- Private Lobby creation with short join code.
- Anonymous local profile: generated player id in localStorage, editable display name, and per-lobby session token.
- Host Player controls mode, team assignment, bot-filled slots, match length, arena selection from currently available arenas, and match start.
- Host ownership transfers to the next joined human when the host disconnects.
- Official Match Modes remain 1v1 and 2v2.
- A 2v2 match can contain any mix of human and Practice Bot Player Slots needed to fill all four slots.
- Practice Bots run server-side and emit the same `PlayerInput` stream as humans.
- Practice Bot scope: chase ball, face/Strike toward opposing Bell, Jump for high ball, Tele-Dash when closing distance on cooldown, and retreat toward own Goal when the ball is dangerous.
- Basic short-window reconnect lets a dropped human reclaim the same Player Slot.
- Flat Dojo and all-rounder baseline remain acceptable until Phase 5 adds roster and arena variety.

## Technical Scope

- Create `apps/worker` using Cloudflare Workers and Durable Objects via PartyServer/PartySocket.
- Use Durable Objects for ephemeral lobby state, presence, slot assignment, host ownership, and reconnect coordination.
- Do not introduce D1, KV, accounts, ranked state, or permanent profiles.
- Add worker/client protocol messages to `packages/protocol` for lobby creation, join, slot updates, bot toggles, host actions, match launch, and reconnect token exchange.
- Extend Colyseus match rooms to support 2v2 Player Slots and server-side Practice Bot input generators.
- Keep Teams gameplay-neutral beyond side color, spawn side, score ownership, teammate indicators, and grouping.
- Preserve full-strength Friendly Fire for allied Strikes in 2v2.
- Add `pnpm dev:worker` and update `pnpm dev` for web + server + worker when needed.

## Starting Defaults

- Reconnect grace period: define as typed config and start with a short window suitable for browser refresh or transient disconnect.
- Practice Bot decision rate: aligned to 30Hz input ticks or a deterministic divisor of the sim tick.
- Lobby code lifetime: scoped to active private lobbies only.
- Match length: default 3:00, host-selectable 2:00 to 5:00.

## Out Of Scope

- Public matchmaking queues, ranked matchmaking, MMR, and leaderboards.
- Persistent accounts, OAuth, email, passwords, D1/KV persistence, and profile history.
- Character roster, cooldown specials, final character identities, and additional arenas beyond what prior phases provide.
- Advanced bot tactics, difficulty levels, pathfinding, ML, or ranked bot use.
- Spectator mode.
- Durable Object authoritative match loop experiments.

## Acceptance Criteria

- `pnpm dev` can launch web, server, and worker in local development.
- A host can create a Private Lobby and share a join code.
- Human clients can join, set display names, occupy slots, switch teams where allowed, and see presence updates.
- The host can fill empty slots with Practice Bots.
- A three-human 2v2 can launch with one Practice Bot-filled slot.
- A full 2v2 match starts on the Colyseus server and completes using authoritative rules.
- Practice Bots are visible as normal players and use the same input pipeline.
- A disconnected human can reconnect within the grace period and reclaim the same Player Slot.
- Host transfer works when the host leaves before match start.

## Human Acceptance Script

1. Run `pnpm dev`.
2. Create a Private Lobby in one browser.
3. Join from two additional browser clients using the lobby code.
4. Fill the fourth Player Slot with a Practice Bot.
5. Assign Teams for 2v2 and start the match.
6. Play until a Bell Ring occurs and confirm all clients agree on score.
7. Refresh one human client during the match and reconnect within the grace period.
8. Confirm the human reclaims the same Player Slot.

## Required Tests

- Worker/DO tests for lobby creation, join codes, slot assignment, host transfer, and bot toggles.
- Protocol contract tests for lobby and reconnect messages.
- Server room tests for 2v2 team assignment and Practice Bot input generation.
- Replay tests that include a Practice Bot input stream.
- Playwright multi-client smoke test for private lobby creation and match launch.
- Reconnect tests for token validity, grace period, and failed late reconnect.

## Agent Workflow

1. Refine Cloudflare local-dev tooling against the current repo and credentials-free constraints.
2. Plan lobby state transitions before UI forms.
3. Implement human slots before bot fill.
4. Implement bot input generation through the same protocol path as humans.
5. Review that lobby state stays ephemeral and no account/ranked persistence sneaks in.

## Handoff To Phase 5

Phase 5 should use the Private Lobby and 2v2 room model as the selection surface for characters and arenas. Avoid redesigning lobby ownership unless Phase 4 acceptance exposed a concrete flaw.
