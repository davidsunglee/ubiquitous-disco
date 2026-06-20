import type { Slot } from "@bb/protocol";
import { type Client, Room } from "@colyseus/core";

export class MatchRoom extends Room {
  maxClients = 2;
  patchRate = 0; // disable automatic Schema patch broadcasting

  private slotOf = new Map<string, Slot>();

  onCreate(): void {
    // message handlers registered in Phase 2
  }

  onJoin(client: Client): void {
    const slot: Slot = this.slotOf.size === 0 ? 0 : 1;
    this.slotOf.set(client.sessionId, slot);

    // Tell this client its own slot assignment.
    client.send("RoomReady", { type: "RoomReady", slot, full: false });

    if (this.slotOf.size === 2) {
      // Both players present — broadcast updated "full=true" with each client's own slot.
      for (const [sessionId, s] of this.slotOf) {
        const target = this.clients.find((c) => c.sessionId === sessionId);
        if (target) {
          target.send("RoomReady", { type: "RoomReady", slot: s, full: true });
        }
      }
    }
  }

  onLeave(client: Client): void {
    this.slotOf.delete(client.sessionId);
  }

  slot(client: Client): Slot {
    return this.slotOf.get(client.sessionId) ?? 0;
  }

  /** Expose slot map size for testing without coupling to Colyseus internals. */
  get slotCount(): number {
    return this.slotOf.size;
  }

  /** Expose slot for a given sessionId for testing. */
  slotForSession(sessionId: string): Slot | undefined {
    return this.slotOf.get(sessionId);
  }
}
