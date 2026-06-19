# Phase 6: Production Hardening And Mobile Readiness

## Playable Outcome

The current 1v1 and 2v2 private-lobby game runs as a hardened browser experience with mobile-landscape readiness, prototype-level readability polish, latency and region tools, an Edgegap-ready server container, load-test evidence, and stress-tested WebSocket netcode.

## Functional Scope

- Preserve all Phase 5 gameplay as the core demo path.
- Readable Prototype Art Pass: cohesive placeholder palette, clear silhouettes, readable team indicators beyond color alone, basic impact/Bell Ring effects, simple animation polish, basic SFX, polished HUD, and polished touch controls.
- Mobile browser readiness: landscape-required phone layout, iPad/tablet landscape layout, readable HUD, touch control scale/opacity settings, and explicit iOS Safari verification.
- PWA readiness checks for browser installability where practical.
- Minimal Capacitor proof-of-wrap to validate the native path, without app-store packaging or native plugin scope.
- Hardened reconnect behavior, clearer connection states, and better failure messages.
- Latency and region tools: show measured ping/RTT to available deployment regions, choose a default region for private lobbies, allow manual override where supported, and log latency metrics.
- Private-lobby physics modifiers only: gravity scale and ball bounciness.
- Network hardening under simulated 120ms RTT plus modest jitter/loss.
- Lag-compensation decision trigger: measure strike fairness and correction telemetry, but do not implement server rewind in this phase.

## Technical Scope

- Produce an Edgegap-ready Docker/OCI image for the Colyseus/Bun server.
- Add container health checks, runtime configuration docs, and an Edgegap deployment runbook/config template.
- Make live Edgegap deployment conditional on credentials and environment access.
- Add load-test scripts that simulate multiple rooms and bot/human input streams.
- Server tick budget target: average sim tick CPU under 25% of the 33.3ms tick budget and p95 under 50% for a 4-player match on the target container.
- Extend built-in network simulator for Phase 6 network conditions and Playwright/manual demos.
- Add mobile viewport and touch smoke tests.
- Keep WebSockets as the only v1 transport.
- Keep accounts, ranked, D1/KV, leaderboards, and public matchmaking out of scope.

## Starting Defaults

- Network stress target: 120ms RTT plus modest jitter/loss with visually tolerable corrections.
- Region selection: minimal manual/private-lobby tooling, not full regional matchmaking.
- Physics modifiers: gravity scale and ball bounciness only.
- Accessibility/readability baseline: colorblind-safe indicators beyond color alone, readable HUD at phone landscape size, camera motion caps, and reduced screen-shake option.
- Prototype art: cohesive and readable, but not final production art.

## Out Of Scope

- Full native iOS/Android app delivery, app-store packaging, and production native plugins.
- Ranked matchmaking, accounts, MMR, leaderboards, public matchmaking queues, and persistent profile services.
- WebRTC DataChannel or WebTransport transport upgrades.
- Server rewind, full lag compensation, or full world rollback.
- Player-facing spectator mode.
- Production art, final character identities, and final branding.
- New official Match Modes or large party modifier sets.

## Acceptance Criteria

- `pnpm verify` passes locally and in CI.
- `pnpm dev` still supports the full private-lobby 1v1/2v2 flow.
- The game is playable and readable in mobile landscape viewports with touch controls.
- iOS Safari is explicitly verified manually or documented as blocked with a concrete reason.
- Portrait phone view shows a rotate-device prompt.
- PWA readiness checks pass or document remaining non-blocking gaps.
- Minimal Capacitor proof-of-wrap builds far enough to validate the path, subject to local platform tooling.
- Server container builds, starts, reports healthy, and is documented for Edgegap deployment.
- Load-test report shows server tick budget targets for representative 4-player rooms.
- Built-in network simulator validates 120ms RTT plus modest jitter/loss with tolerable correction behavior.
- Region/latency UI exposes measured RTT and chosen region for private lobbies.
- Gravity and ball-bounciness private-lobby modifiers work and are excluded from default competitive assumptions.

## Human Acceptance Script

1. Run `pnpm verify`.
2. Run `pnpm dev` and create a Private Lobby.
3. Start a 2v2 match with at least one Practice Bot.
4. Verify the readable prototype visuals, HUD, effects, audio cues, and team indicators.
5. Test desktop, tablet landscape, and phone landscape viewport sizes.
6. Test portrait phone behavior and confirm the rotate prompt appears.
7. Enable 120ms RTT plus modest jitter/loss in the network simulator and play until a Bell Ring.
8. Build and run the server container health check.
9. Run the load-test script and inspect the tick budget report.
10. Open the region/latency UI and confirm measured RTT is displayed.
11. Start a private match with gravity and ball-bounciness modifiers and confirm the match still completes.

## Required Tests

- Full `pnpm verify` CI gate.
- Playwright smoke tests for private lobby flow, match launch, and match completion.
- Playwright mobile viewport tests for landscape touch layout and portrait prompt.
- Network simulator tests for 120ms RTT, jitter, dropped snapshots, and correction thresholds.
- Load-test script for multiple rooms with generated input streams.
- Container build and health-check verification.
- Tests for physics modifier config validation and replay determinism.
- Tests for reconnect hardening edge cases.
- Tests or scripted checks for PWA manifest/service worker behavior where implemented.

## Agent Workflow

1. Refine hardening scope against Phase 5's real pain points before adding polish.
2. Plan reliability, mobile, and deployment work as separate task groups.
3. Implement measurable hardening before visual polish.
4. Use load and network reports as acceptance artifacts, not anecdotes.
5. Review that Phase 6 does not silently add ranked, accounts, transport upgrades, or full native scope.

## Handoff After Phase 6

After Phase 6, likely follow-up specs are ranked/accounts, public matchmaking, final art direction, original character identities, WebRTC/WebTransport evaluation, player-facing spectator mode, server rewind if telemetry proves it necessary, and full native app delivery.
