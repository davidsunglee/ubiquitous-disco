# Worker-Owned Launch Manifests

Private Lobbies lock into immutable, worker-owned launch manifests with opaque launch ids and per-human join tokens. Colyseus validates the manifest and Player Slot claims before accepting match connections, which keeps the Durable Object worker authoritative for lobby coordination without putting it on the latency-sensitive gameplay input path.

## Considered Options

- Browser-provided launch manifests: rejected because browsers would carry too much authority over slots and match settings.
- Direct worker-created Colyseus rooms: rejected because it adds server API surface and local orchestration complexity for little gain.
