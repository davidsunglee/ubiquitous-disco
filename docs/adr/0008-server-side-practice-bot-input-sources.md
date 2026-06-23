# Server-Side Practice Bot Input Sources

Practice Bots run inside the authoritative Colyseus `MatchRoom` as deterministic `SlotInputSource`s. Human Player Slots read from input buffers, Practice Bot Player Slots sample `InputFrame`s from authoritative state, and the match loop consumes one `InputFrame` per active Player Slot before calling `sim.step()`.

## Considered Options

- Synthetic WebSocket `PlayerInput` messages for Practice Bots: rejected because they add artificial sequence numbers and networking-shaped plumbing for non-networked inputs.
- Worker-generated Practice Bot inputs: rejected because that would put the coordination layer on the gameplay input path.
- Host-browser-generated Practice Bot inputs: rejected because it violates server authority and creates host advantage/desync risk.
