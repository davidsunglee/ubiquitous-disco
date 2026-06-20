import type { Slot } from "@bb/protocol";
// @colyseus/sdk 0.17 exports the class as both `Client` (alias) and `ColyseusSDK`
import { Client, type Room } from "@colyseus/sdk";
import { SERVER_URL } from "./config";

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
}
