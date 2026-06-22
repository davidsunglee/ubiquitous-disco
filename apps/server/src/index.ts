import { initSim } from "@bb/sim";
import { Server } from "@colyseus/core";
import { MatchRoom } from "./MatchRoom";
import { createTransport } from "./transport";

// MatchRoom creates a @bb/sim simulation when a room is first created.
// Rapier (WebAssembly) must be initialised before any simulation can be built.
await initSim();

const transport = createTransport();

const gameServer = new Server({ transport });

// Register the match room type. filterBy("launchId") makes joinOrCreate reuse
// the room created for a given launch, so all humans of one launch (Phase 5
// manifest handoff) land in the same MatchRoom.
gameServer.define("match", MatchRoom).filterBy(["launchId"]);

const port = Number(process.env.PORT ?? 2567);

// Health routes via the BunWebSockets Express-compatible app.
// getExpressApp() must be called AFTER new Server() initialises the transport
// but BEFORE listen() opens the port.
//
// /healthz/live  — liveness: process is running and responsive (always 200 once
//                  past this point; used by Docker HEALTHCHECK).
// /healthz/ready — readiness: transport + matchmaker are initialised and the
//                  server is ready to accept WebSocket connections (200 after
//                  listen() completes; 503 before).
const app = (
  transport as import("@colyseus/bun-websockets").BunWebSockets
).getExpressApp();

app.get("/healthz/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness flag: flipped to true after gameServer.listen() resolves.
let serverReady = false;

app.get("/healthz/ready", (_req, res) => {
  if (serverReady) {
    res.status(200).json({ status: "ready" });
  } else {
    res.status(503).json({ status: "starting" });
  }
});

await gameServer.listen(port);
serverReady = true;
console.log(`[server] Colyseus listening on ws://0.0.0.0:${port}`);
