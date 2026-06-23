# Phase 1: Local Feel Sandbox

## Playable Outcome

A reviewer can launch a local browser build, control one all-rounder character in Flat Dojo, move, Jump, Tele-Dash, Strike the ball, charge/directionally shape Strikes, and ring either Bell. The slice is fun enough to tune ball, movement, and scoring feel without networking, opponents, or full match rules.

## Functional Scope

- One controllable all-rounder using the Sifu placeholder identity.
- One ball with gravity, restitution, damping, speed clamp, light player body contact, and Strike impulse response.
- Flat Dojo as the first Mirrored Scoring Puzzle: mostly flat floor, walls, two elevated Bells, low overhangs/ledges, spawn point, and reset point.
- Bell Ring detection when the ball contacts a defended Bell Hit-Zone.
- Core actions: variable-height Jump, Tele-Dash blink, and Strike.
- Strike variants in this phase: tap Strike, hold-to-charge Strike, directional impulse shaping, and upward pop.
- No Tele-Dash invulnerability frames.
- Keyboard and touch input through the same logical input abstraction.
- Dynamic group-framing camera that keeps the active player, ball, and Bells readable.
- Debug/tuning HUD for local development: reset, sim pause/step, key tuning sliders, hitbox/collider overlays, and replay capture.
- Landscape-required phone behavior with a rotate-device prompt if portrait is detected.

## Technical Scope

- Initialize the TypeScript monorepo using PNPM scripts.
- Create `apps/web` with Phaser + Vite + TypeScript.
- Create `packages/sim` with deterministic Rapier hidden behind a Bell Brawl simulation API.
- Use sim-owned world units and X-right/Y-up coordinates.
- Keep Phaser rendering/input separate from authoritative simulation rules.
- Add typed sim configs for movement, ball, Strike, arena, and Bell Ring settings.
- Add a developer replay format containing match seed, sim config version, arena id, roster id, and ordered input frames.
- Add Biome, TypeScript typechecking, Vitest, Playwright smoke testing, and CI.
- Add top-level scripts: `pnpm dev`, `pnpm dev:web`, `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, and `pnpm verify`.

## Starting Defaults

- Sim tick: 30Hz fixed step.
- Input: analog `moveX/moveY` in `[-1, 1]`, plus held states for Jump, Dash, and Strike.
- Strike charge: expose min, max, and full-charge duration in typed config.
- Tele-Dash: fixed distance and cooldown in typed config, with one air Tele-Dash per airtime.
- Ball: expose gravity scale, restitution, damping, radius, mass, max speed, and Strike impulse multipliers in typed config.
- Bell Hit-Zone: separate visible Bell art from the scoring area in arena data.

## Out Of Scope

- Opponent AI or second local player.
- Match timer, score UI beyond Bell Ring feedback, Golden Goal, or reset ceremony.
- Stagger, Knockdown, Specials, roster stats, and arenas beyond Flat Dojo.
- Networking, Colyseus, protocol package, Durable Objects, accounts, lobbies, and persistence.
- Production art or final character identities.

## Acceptance Criteria

- `pnpm dev:web` launches a playable browser sandbox.
- The player can move, Jump, Tele-Dash, and Strike using keyboard.
- The player can move and act using touch controls in landscape layout.
- A charged upward Strike can pop the ball into an elevated Bell.
- Bell Ring feedback is obvious and deterministic in replay.
- Debug overlays can show player, ball, arena colliders, and Bell Hit-Zones.
- Restarting the same replay with the same seed produces the same final sim state hash.
- The game remains playable with programmer art and clear team-neutral colors.

## Human Acceptance Script

1. Run `pnpm dev:web`.
2. Open the local browser URL on desktop.
3. Use keyboard controls to move, Jump, Tele-Dash, and Strike the ball.
4. Charge Strike and use upward direction to ring a Bell.
5. Enable collider overlays and confirm the Bell Hit-Zone is visually understandable.
6. Resize to a phone-landscape viewport and confirm touch controls are usable.
7. Rotate to portrait and confirm the rotate-device prompt appears.

## Required Tests

- Unit tests for input normalization and button-state edge derivation.
- Unit tests for Bell Ring detection.
- Unit tests for Tele-Dash cooldown and one-air-dash reset on landing.
- Replay tests for ball Strike impulse, upward pop, and Bell Ring scoring event.
- Playwright smoke test that loads the sandbox and verifies canvas/HUD presence.
- CI workflow running `pnpm verify`.

## Agent Workflow

1. Refine the setup details against the current empty repo and the brainstorm docs.
2. Plan bootstrap tasks before gameplay tasks.
3. Implement the smallest playable loop before broadening debug tools.
4. Verify determinism with replay hashes before accepting tuning changes.
5. Review that no Phaser physics or pixel units leak into authoritative sim logic.

## Handoff To Phase 2

Phase 2 should build complete local match rules on top of this same sim package. Do not replace the input model, coordinate system, arena data model, or Rapier wrapper without updating ADR 0002.
