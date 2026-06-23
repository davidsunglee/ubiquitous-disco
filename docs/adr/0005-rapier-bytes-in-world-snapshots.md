# Rapier Bytes In World Snapshots

Authoritative `WorldSnapshot`s include base64 Rapier snapshot bytes for reconciliation because lightweight position/velocity restore was not faithful for the dynamic ball after contact. Kinematic player fields remain explicit lightweight state, but clients restore the Rapier world, overlay player fields, and then replay pending inputs.

## Considered Options

- Lightweight JSON-only world state: preferred for protocol readability, but rejected after ball contact fidelity proved insufficient.
- Full Rapier snapshot on the wire: accepted because correctness is more important than snapshot opacity and size at this stage.
