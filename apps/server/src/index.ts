import { Server } from "@colyseus/core";
import { MatchRoom } from "./MatchRoom";
import { createTransport } from "./transport";

const transport = createTransport();

const gameServer = new Server({ transport });

// Register the match room type.
gameServer.define("match", MatchRoom);

const port = Number(process.env.PORT ?? 2567);

// Minimal liveness route via the BunWebSockets Express-compatible app.
// The getExpressApp() call must happen AFTER new Server() initialises the transport,
// but BEFORE listen() opens the port. Phase 6 adds /healthz/ready.
const app = (
  transport as import("@colyseus/bun-websockets").BunWebSockets
).getExpressApp();
app.get("/healthz/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

await gameServer.listen(port);
console.log(`[server] Colyseus listening on ws://0.0.0.0:${port}`);
