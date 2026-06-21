import type { MatchClosed, Slot } from "@bb/protocol";
// @colyseus/sdk 0.17 exports the class as both `Client` (alias) and `ColyseusSDK`
import { Client, type Room } from "@colyseus/sdk";
import { SERVER_URL } from "./config";

/** Callback invoked when the match fails closed (peer left, server shutdown, or WS error). */
export type FailClosedCallback = (
  reason: MatchClosed["reason"] | "ws-error",
) => void;

export class NetClient {
  private client = new Client(SERVER_URL);
  room!: Room;
  slot: Slot = 0;

  /** Create a new room and return its roomId. */
  async create(): Promise<string> {
    this.room = await this.client.create("match");
    return this.room.roomId;
  }

  /** Join an existing room by its roomId. */
  async joinById(id: string): Promise<void> {
    this.room = await this.client.joinById(id);
  }

  /** Register a typed message handler on the connected room. */
  onMessage(type: string, cb: (m: unknown) => void): void {
    this.room.onMessage(type as never, cb as never);
  }

  /** Send a message to the server. */
  send(type: string, payload: unknown): void {
    this.room.send(type as never, payload as never);
  }

  /** Register a leave callback. Receives the WebSocket close code. */
  onLeave(cb: (code: number) => void): void {
    this.room.onLeave.once(cb);
  }

  /**
   * Register a fail-closed callback. Fires on:
   *  - `MatchClosed` server message (peer left or server shutdown)
   *  - `onLeave` (unexpected WebSocket disconnect)
   *  - `onError` (WebSocket error)
   *
   * The callback is idempotent — it fires at most once per room session.
   */
  onFailClosed(cb: FailClosedCallback): void {
    let fired = false;
    const fire = (reason: MatchClosed["reason"] | "ws-error") => {
      if (fired) return;
      fired = true;
      cb(reason);
    };

    // Server-side MatchClosed message (preferred — carries explicit reason).
    this.room.onMessage("MatchClosed" as never, (msg: unknown) => {
      const m = msg as MatchClosed;
      fire(m.reason ?? "peer-left");
    });

    // WebSocket disconnected for any reason (includes graceful room dispose).
    this.room.onLeave.once((_code) => {
      fire("peer-left");
    });

    // WebSocket error (network failure, TLS error, etc.).
    this.room.onError.once((_code, _message) => {
      fire("ws-error");
    });
  }

  /**
   * Sample the current RTT via `room.ping()`. Returns a Promise that resolves
   * with the round-trip time in milliseconds (or rejects if not connected).
   */
  ping(): Promise<number> {
    return new Promise((resolve) => {
      this.room.ping((ms) => resolve(ms));
    });
  }
}
