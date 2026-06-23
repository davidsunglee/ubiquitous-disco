# Phase 5: Roster, Arenas, And Balance

## Playable Outcome

Private lobbies can select any of six placeholder characters and any of three default arenas, then play 1v1 or 2v2 matches with cooldown Specials, visible stats, Overtime Pressure Ramp, and structured match summaries for balance review.

## Functional Scope

- Six brainstorm-placeholder characters remain recognizable placeholders until a later originality/art pass:
- Sifu: all-rounder baseline.
- Vipra: speedster.
- Monkey King: Aerial Trickster with an extra air option.
- Old Master: power zoner.
- Panda: heavy.
- Drunken Boxer: wildcard/disruptor using seeded deterministic randomness where needed.
- Tight stat deltas around the all-rounder baseline, roughly within a 15-20% band.
- One cooldown-based Special per character, triggered by the dedicated Special input.
- Visible stat table in lobby or character select.
- Three default Mirrored Scoring Puzzle arenas: Flat Dojo, Pillared Temple, and Twin-Ledge.
- Overtime Pressure Ramp: Bell Hit-Zones visibly grow during Golden Goal at configured intervals, with clear VFX/HUD messaging and a cap.
- Structured balance telemetry summaries after matches.
- Practice Bots can use any character at a basic level, but advanced character-specific tactics are not required.

## Technical Scope

- Extend typed sim configs for character stats, Specials, cooldowns, and arena definitions.
- Keep character stats and arena data owned by `packages/sim` and rendered by `apps/web`.
- Use seeded deterministic RNG for any wildcard Special or randomized angle.
- Add event logs and aggregate match summaries for Bell Rings, match duration, character picks, arena, Knockdowns, Friendly Fire Knockdowns, bot slots, RTT/jitter, reconciliation corrections, and disconnects.
- Store telemetry locally or server-side as structured logs/summaries, not in an external analytics service.
- Add visible dev/balance surfaces for inspecting character pick, arena, key match events, and summary stats.
- Preserve replay determinism across character Specials and all three arenas.

## Starting Defaults

- Character stat spread: use the brainstorm table as starting values, not final balance.
- Special resource: cooldown only, with visible cooldown state.
- Overtime Pressure Ramp: grow Bell Hit-Zone on a configured interval such as every 15 seconds, capped at a safe maximum.
- Default/ranked-style arenas: mirrored left-right within each arena, with different geometry across arenas.
- No team passives or faction systems.

## Out Of Scope

- Final character names, final visual identities, final animation sets, and production art.
- Ranked queues, accounts, MMR, public leaderboards, external analytics, and persistent profile stats.
- New official Match Modes beyond 1v1 and 2v2.
- Environmental hazards such as sandstorms, moving platforms, sticky ball, or score multipliers.
- Full tactical bots or difficulty settings.
- Transport upgrades, server rewind, and spectator mode.

## Acceptance Criteria

- Private lobby host can choose 1v1 or 2v2, character per Player Slot, and one of three arenas.
- All six placeholder characters are playable by humans.
- Stat differences are visible in the stat table and perceivable in movement/Strike/Knockdown behavior.
- Each character has one usable cooldown Special through the dedicated Special input.
- Monkey King has an extra air option distinct from the baseline single jump plus air Tele-Dash.
- Drunken Boxer randomness is deterministic from match seed and replayable.
- All three arenas are mirrored scoring puzzles and produce distinct scoring paths.
- Golden Goal uses visible Bell Hit-Zone growth and ends on the next Bell Ring.
- Match summaries include the required balance telemetry fields.
- Replays remain deterministic across roster, arenas, Specials, and Overtime Pressure Ramp.

## Human Acceptance Script

1. Run `pnpm dev`.
2. Create a Private Lobby.
3. Select different characters for each Player Slot and view the stat table.
4. Select each arena in turn and start a short match.
5. Use at least two different character Specials.
6. Force or wait for Golden Goal and confirm Bell Hit-Zones visibly grow.
7. Complete a match and inspect the structured match summary.
8. Replay a match involving Drunken Boxer and confirm deterministic behavior.

## Required Tests

- Unit tests for character stat config loading and bounds.
- Unit tests for cooldown Special availability and cooldown reset rules.
- Unit tests for seeded RNG reproducibility.
- Arena validation tests for mirrored geometry, spawn points, Bell Hit-Zones, and camera bounds.
- Replay tests for at least one Special per character.
- Replay tests for Overtime Pressure Ramp timing and cap.
- Telemetry tests for required match summary fields.
- Playwright smoke test for character select, arena select, and match summary display.

## Agent Workflow

1. Refine placeholder character behavior against current combat and movement feel.
2. Plan data/config changes before UI selection screens.
3. Implement arena validation before adding all arenas.
4. Implement one character Special end-to-end before adding the rest.
5. Review balance changes for readability and avoid hidden multipliers outside typed configs.

## Handoff To Phase 6

Phase 6 should harden the existing private-lobby, roster, arena, and telemetry flows rather than adding major new gameplay systems.
