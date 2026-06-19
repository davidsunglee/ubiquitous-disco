# Deterministic Rapier Behind A Shared Simulation Wrapper

Bell Brawl will use deterministic Rapier for ball and collision physics, but Rapier must be wrapped behind `packages/sim` so game code speaks Bell Brawl concepts instead of physics-engine concepts. This preserves replayable tests and tighter client prediction while keeping Phaser physics out of authoritative rules.

## Considered Options

- Fully hand-rolled physics: simplest to own, but gives up collision robustness that Rapier can provide.
- Direct Rapier usage from client and server code: fastest initially, but leaks implementation details and makes later replacement hard.
- Deterministic Rapier wrapper in the shared sim package: accepted because the performance cost is acceptable for a small match and the boundary keeps the simulation portable.

## Consequences

- `packages/sim` owns world units, coordinate orientation, physics setup, arena colliders, and replay determinism.
- Phaser renders simulation output and handles input/audio/scenes, but does not define authoritative physics.
- Gameplay randomness must use seeded deterministic RNG owned by the simulation package.
