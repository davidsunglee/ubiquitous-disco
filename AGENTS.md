# Repository Guidelines

## Commit messages

All commits MUST follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) spec.

Format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

- Use a `!` after the type/scope (e.g. `feat!:`) or a `BREAKING CHANGE:` footer to signal a breaking change.
- The description should be concise, lowercase, and written in the imperative mood.

Commit messages are enforced by a `commit-msg` git hook (commitlint via Husky). Non-conforming messages will be rejected.

## Vocabulary

Use the canonical terms defined in [`CONTEXT.md`](./CONTEXT.md) in code, comments,
commits, and docs. `CONTEXT.md` is the source of truth for naming (e.g. **Strike**,
not "attack"; **Bell Ring**, not "goal"). Review your work for naming drift against it.

For durable technical facts — stack, monorepo shape, design invariants, and deferred
scope — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Standard commands

Preserve or add these top-level scripts as they become applicable:

```sh
pnpm dev
pnpm dev:web
pnpm dev:server
pnpm dev:worker
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm lint
pnpm format
pnpm verify
```

`pnpm verify` is the CI-equivalent aggregate command. It should run typecheck, lint,
unit/replay tests, and applicable browser smoke tests.

## Per-phase agent workflow

The slice sequence lives in [`docs/phases/README.md`](./docs/phases/README.md). For every phase:

1. Refine the phase spec against current code and prior phase output.
2. Produce an implementation plan with small, independently reviewable tasks.
3. Execute the plan with code, tests, and infrastructure changes.
4. Run the required verification commands and the human acceptance script.
5. Review the result for regressions, naming drift from `CONTEXT.md`, and unnecessary scope growth.
6. Update the phase spec only when implementation reality changes a decision or acceptance criterion.

Every phase must end with a playable demo command and a human acceptance script.
