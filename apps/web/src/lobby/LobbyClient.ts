/**
 * LobbyClient — PartySocket-based WebSocket client for the PrivateLobby DO.
 *
 * Connects to /parties/private-lobby/:code on the worker and dispatches
 * incoming LobbyState messages to registered listeners.
 */

import {
  deserializeLobbyState,
  type LobbyJoin,
  type LobbyState,
} from "@bb/protocol";
import PartySocket from "partysocket";
import { WORKER_URL } from "./config";

export class LobbyClient {
  private socket: PartySocket | null = null;
  private listeners: ((state: LobbyState) => void)[] = [];

  /**
   * Connect to a lobby by code and send the player's profile.
   *
   * @param code        The short lobby code (e.g. "ABCD12").
   * @param playerId    The local player's stable UUID.
   * @param displayName The player's display name.
   */
  connect(code: string, playerId: string, displayName: string): void {
    if (this.socket) {
      this.socket.close();
    }

    this.socket = new PartySocket({
      host: WORKER_URL.replace(/^https?:\/\//, ""),
      room: code,
      party: "private-lobby",
    });

    this.socket.addEventListener("open", () => {
      const joinMsg: LobbyJoin = {
        type: "LobbyJoin",
        playerId,
        displayName,
      };
      this.socket?.send(JSON.stringify(joinMsg));
    });

    this.socket.addEventListener("message", (evt: MessageEvent<string>) => {
      try {
        const state = deserializeLobbyState(evt.data);
        if (state.type === "LobbyState") {
          for (const listener of this.listeners) {
            listener(state);
          }
        }
      } catch {
        // Ignore malformed messages.
      }
    });
  }

  /** Register a listener for incoming LobbyState updates. */
  onState(listener: (state: LobbyState) => void): void {
    this.listeners.push(listener);
  }

  /** Close the WebSocket connection. */
  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
