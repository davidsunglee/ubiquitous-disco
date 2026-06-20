import type { PlayerInput, Slot, WorldSnapshot } from "@bb/protocol";
import {
  createSimulation,
  DEFAULT_CONFIG,
  FLAT_DOJO,
  toAuthoritativeState,
} from "@bb/sim";
import { type Client, Room } from "@colyseus/core";
import { FixedStepAccumulator } from "./fixedStep";
import { InputBuffer } from "./inputBuffer";

// 30Hz tick → 15Hz snapshot
const SNAPSHOT_EVERY = 2;
const FIXED_STEP_MS = 1000 / DEFAULT_CONFIG.tickHz; // 33.33ms

export class MatchRoom extends Room {
  maxClients = 2;
  // patchRate is set to 0 inside onCreate(), AFTER setSimulationInterval — not
  // as a class field. See the comment at that assignment for why the ordering
  // matters (it avoids an orphaned 60Hz clock.tick() interval).

  private slotOf = new Map<string, Slot>();

  // Authoritative sim + buffers (initialised in onCreate after initSim() is awaited)
  private sim!: ReturnType<typeof createSimulation>;
  private buffers!: [InputBuffer, InputBuffer];
  private stepClock = new FixedStepAccumulator(FIXED_STEP_MS);
  private serverTick = 0;

  onCreate(): void {
    // Construct the simulation here (not as a class field) so that Rapier WASM
    // is guaranteed to have been initialised via initSim() in index.ts before
    // any room can be created.
    this.sim = createSimulation({
      config: DEFAULT_CONFIG,
      arena: FLAT_DOJO,
      seed: 1234,
    });
    this.buffers = [new InputBuffer(), new InputBuffer()];

    // Register PlayerInput handler.
    this.onMessage("PlayerInput", (client, msg: PlayerInput) => {
      const s = this.slot(client);
      this.buffers[s].push(msg.frames);
    });

    // Fixed-step authoritative loop at 30Hz.
    //
    // setSimulationInterval fires roughly every FIXED_STEP_MS. We drive the loop
    // from FixedStepAccumulator (real wall-clock time) rather than the delta
    // Colyseus passes, so the sim stays at a true 30Hz regardless of timer jitter.
    this.setSimulationInterval(() => {
      const steps = this.stepClock.pump();
      for (let i = 0; i < steps; i++) {
        this.tickOnce();
      }
    }, FIXED_STEP_MS);

    // Disable Schema patch broadcasting (we broadcast our own WorldSnapshots).
    // This MUST run after setSimulationInterval: Colyseus's patchRate setter
    // only installs its 60Hz clock.tick() fallback interval when no simulation
    // interval exists yet (`else if (!this._simulationInterval)`). Setting it as
    // a class field — before onCreate — tripped that branch and left an orphaned
    // 60Hz ticker running for the room's lifetime. Setting it here skips it.
    this.patchRate = 0;
  }

  private tickOnce(): void {
    const a = this.buffers[0].take();
    const b = this.buffers[1].take();
    this.sim.step([a.input, b.input]);
    this.serverTick += 1;

    const lastAckedSeq: [number, number] = [
      this.buffers[0].lastAckedSeq,
      this.buffers[1].lastAckedSeq,
    ];

    if (this.serverTick % SNAPSHOT_EVERY === 0) {
      const auth = toAuthoritativeState(this.sim);

      // Encode rapierBytes as base64 for JSON transport.
      const rapierBytesB64 = uint8ArrayToBase64(auth.rapierBytes);

      const snapshot: WorldSnapshot = {
        type: "WorldSnapshot",
        serverTick: this.serverTick,
        players: auth.players,
        ball: auth.ball,
        rapierBytesB64,
        match: auth.match,
        lastAckedSeq,
      };

      this.broadcast("WorldSnapshot", snapshot);

      // Also broadcast a standalone InputAck so clients can trim pending lists
      // even between snapshots (snapshot also carries lastAckedSeq, but the
      // standalone ack arrives at 15Hz between-snapshots too).
      this.broadcast("InputAck", { type: "InputAck", lastAckedSeq });
    }
  }

  onJoin(client: Client): void {
    const slot: Slot = this.slotOf.size === 0 ? 0 : 1;
    this.slotOf.set(client.sessionId, slot);

    // Tell this client its own slot assignment.
    // Phase 1 note: each client gets its OWN slot — per-recipient send, not broadcast.
    client.send("RoomReady", { type: "RoomReady", slot, full: false });

    if (this.slotOf.size === 2) {
      // Both players present — send each client their own "full=true" with correct slot.
      for (const [sessionId, s] of this.slotOf) {
        const target = this.clients.find((c) => c.sessionId === sessionId);
        if (target) {
          target.send("RoomReady", {
            type: "RoomReady",
            slot: s,
            full: true,
          });
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

  /** Expose serverTick for testing. */
  get tick(): number {
    return this.serverTick;
  }

  /** Expose buffers for testing. */
  get inputBuffers(): [InputBuffer, InputBuffer] {
    return this.buffers;
  }

  /** Expose sim for testing. */
  get simulation() {
    return this.sim;
  }
}

// ── Base64 helpers (no Node.js Buffer — works in Bun and Node) ────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Bun and modern Node both support btoa via the global; build a binary string.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}
