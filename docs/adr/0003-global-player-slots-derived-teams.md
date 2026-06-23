# Global Player Slots With Derived Teams

Bell Brawl uses four global `PlayerSlotId`s across lobby seating, protocol, simulation arrays, acknowledgements, snapshots, and reconnect. Team membership is derived from slot id: slots `0` and `1` are Team 0, slots `2` and `3` are Team 1; 1v1 activates slots `0` and `2`, while 2v2 activates all four.

## Considered Options

- Reuse slots `0` and `1` for 1v1: rejected because it would put both players on Team 0 unless Team derivation became mode-dependent.
- Separate lobby seat ids from match Player Slot ids: rejected because it adds translation complexity without a current gameplay need.
