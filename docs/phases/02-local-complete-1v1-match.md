# Phase 2: Local Complete 1v1 Match

## Playable Outcome

Two local humans can complete a full 1v1 Bell Brawl match on one desktop using two keyboard mappings. The match has scoring, a timer, Golden Goal, Stagger, Knockdown, aerial Strike variants, and a complete reset loop after each Bell Ring.

## Functional Scope

- Two human-controlled Player Slots in official 1v1 Match Mode.
- Two keyboard mappings using the same logical input abstraction from Phase 1.
- Time-based win condition: default 3:00, most points wins, tie enters Golden Goal.
- Bell Ring rule: when the ball contacts a defended Bell Hit-Zone, the opposing Team scores 1 point, including when a player rings their own Bell.
- Score UI, match timer, Golden Goal state, Bell Ring pause, spawn reset, and match-end summary.
- Strike can hit players and the ball.
- Aerial Strike variant: airborne Strike near the ball becomes a header/air redirect; downward input becomes a spike.
- Stagger accumulation, Knockdown, stand-up, and Recovery Invulnerability.
- Anti-stunlock rules for repeated hits and post-Knockdown recovery.
- Full-strength Friendly Fire semantics in the rules engine, even though local 1v1 has no teammate.
- Players pass through other players, while ball-player collision and Strike-player overlap remain active.
- Group-framing camera tuned for two players, the ball, and both Bells.

## Technical Scope

- Extend `packages/sim` with match lifecycle state: pre-round, playing, Bell Ring pause, reset, overtime, complete.
- Add Team, Player Slot, score, timer, and Golden Goal state to the sim model.
- Add Stagger, Knockdown, Recovery Invulnerability, Strike overlap, and anti-stunlock config.
- Keep all match rules deterministic and replayable.
- Extend replay fixtures to support two input streams.
- Add local match UI in `apps/web` without introducing React.
- Extend typed configs for match length, scoring pause, Stagger thresholds, Knockdown duration, and Recovery Invulnerability.
- Preserve `pnpm verify` as the aggregate quality gate.

## Starting Defaults

- Default match length: 3:00.
- Private/local configurable match length target: 2:00 to 5:00, with UI allowed to arrive later.
- Golden Goal: first Bell Ring wins after tied regulation.
- Overtime Pressure Ramp: not implemented yet.
- Knockdown duration: expose as typed config, with a starting target around 1.0 to 1.5 seconds.
- Recovery Invulnerability: expose as typed config and make it visually readable.

## Out Of Scope

- Online multiplayer, Colyseus, snapshots, prediction, reconciliation, and interpolation.
- Bot-filled slots or Practice Bot behavior.
- Durable Object lobbies or Cloudflare worker code.
- Six-character roster, character stat deltas, cooldown Specials, and extra arenas.
- Public matchmaking, ranked play, accounts, telemetry dashboards, and persistence.

## Acceptance Criteria

- `pnpm dev:web` launches a local 1v1 mode.
- Two players can control separate characters using two keyboard mappings.
- Either player can ring either Bell, including their own Bell.
- Regulation time can end with a winner.
- A tied match enters Golden Goal and ends on the next Bell Ring.
- Strikes can produce Stagger and Knockdown.
- Knockdown prevents control temporarily and then returns control with visible Recovery Invulnerability.
- Players pass through each other without body blocking.
- Replays of a complete local match are deterministic.

## Human Acceptance Script

1. Run `pnpm dev:web`.
2. Start local 1v1.
3. Use both keyboard mappings to move both players.
4. Strike the ball into a defended Bell and confirm the opposing Team scores.
5. Strike a player enough times to cause Knockdown and confirm they recover.
6. Force a tie at the end of regulation and confirm Golden Goal begins.
7. Ring a Bell in Golden Goal and confirm the match ends.
8. Replay a captured match and confirm it reaches the same final state.

## Required Tests

- Unit tests for score ownership when either Bell is rung.
- Unit tests for match timer, regulation completion, and Golden Goal transition.
- Unit tests for Stagger threshold, Knockdown duration, and Recovery Invulnerability.
- Unit tests for player pass-through behavior and Strike overlap behavior.
- Replay tests for a complete 1v1 match path.
- Playwright smoke test for starting local 1v1 and observing match UI.

## Agent Workflow

1. Refine local match rules against Phase 1's actual sim state shape.
2. Plan match lifecycle changes before UI polish.
3. Implement scoring and timer before combat complexity.
4. Add combat states with replay tests before tuning values.
5. Review terminology against `CONTEXT.md`, especially Strike, Stagger, Knockdown, Bell, and Bell Ring.

## Handoff To Phase 3

Phase 3 should move this same deterministic 1v1 match simulation behind an authoritative Colyseus room. Do not fork server rules from local rules.
