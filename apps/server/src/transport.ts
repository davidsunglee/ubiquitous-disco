import { BunWebSockets } from "@colyseus/bun-websockets";
import type { Transport } from "@colyseus/core";

// Q1: swap to `new uWebSocketsTransport()` here if Bun fails the determinism/playable gate.
// Phase 0 confirmed Bun is fine — using BunWebSockets.
export function createTransport(): Transport {
  return new BunWebSockets();
}
