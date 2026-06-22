/**
 * LobbyClient — PartySocket-based WebSocket client for the PrivateLobby DO.
 *
 * Connects to /parties/private-lobby/:code on the worker and dispatches
 * incoming LobbyState messages to registered listeners.
 */

import {
  type LobbyCommand,
  type LobbyJoin,
  type LobbyNotice,
  type LobbyState,
  type MatchLaunch,
  serializeLobbyCommand,
} from "@bb/protocol";
import PartySocket from "partysocket";
import { WORKER_URL } from "./config";

export class LobbyClient {
  private socket: PartySocket | null = null;
  private listeners: ((state: LobbyState) => void)[] = [];
  private launchListeners: ((launch: MatchLaunch) => void)[] = [];
  private noticeListeners: ((notice: LobbyNotice) => void)[] = [];

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
        const msg = JSON.parse(evt.data) as { type?: string };
        if (msg.type === "LobbyState") {
          for (const listener of this.listeners) {
            listener(msg as LobbyState);
          }
        } else if (msg.type === "MatchLaunch") {
          for (const listener of this.launchListeners) {
            listener(msg as MatchLaunch);
          }
        } else if (msg.type === "LobbyNotice") {
          for (const listener of this.noticeListeners) {
            listener(msg as LobbyNotice);
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

  /** Register a listener for the MatchLaunch handoff (delivered on Host start). */
  onLaunch(listener: (launch: MatchLaunch) => void): void {
    this.launchListeners.push(listener);
  }

  /** Register a listener for LobbyNotice messages (lock guard feedback). */
  onNotice(listener: (notice: LobbyNotice) => void): void {
    this.noticeListeners.push(listener);
  }

  /** Send a host-control command (seat move, bot fill/clear, settings, start). */
  sendCommand(cmd: LobbyCommand): void {
    this.socket?.send(serializeLobbyCommand(cmd));
  }

  /** Close the WebSocket connection. */
  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
