# Append-Only Sim State Hashing

Any tick-affecting simulation state not captured by Rapier is appended to fixed-layout serializers and included in `hashState()`. Static match setup such as config, arena, and selected Characters is resolved from frozen setup data rather than embedded in mutable actor serialization.

## Consequences

- New tick-affecting fields must append to serializers instead of shifting existing offsets.
- Cross-engine replay hashes are the guardrail for deterministic changes.
