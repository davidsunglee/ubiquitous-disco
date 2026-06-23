# Match Summary Aggregation Outside The Sim

Match summaries and balance telemetry are aggregated outside the deterministic simulation, by server or hotseat layers that drain sim events and merge network metrics they already own. The sim remains pure and does not store transport data such as RTT, jitter, reconciliation corrections, or disconnects.

## Consequences

- Network-only fields may be absent or zero for hotseat matches.
- Balance summaries can evolve without changing deterministic match state.
