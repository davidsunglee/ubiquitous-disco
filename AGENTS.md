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
