/**
 * ConnectionOverlay — DOM overlay for network connection status and room create/join.
 *
 * Sits inside #game-container and tracks the canvas position/size each frame
 * (same pattern as GameScene.updateMatchHud). Provides data-testid hooks for
 * Playwright tests.
 *
 * Phase 5 additions:
 *  - Fail-closed banner (`data-testid="net-closed"`) shown when the match ends
 *    due to a peer disconnect or server shutdown.
 *  - Optional telemetry readout (`data-testid="net-telemetry"`) showing RTT.
 */

import type { MatchClosed, PlayerSlotId, Slot } from "@bb/protocol";
import type { NetClient } from "../net/NetClient";

type Status = "idle" | "connecting" | "connected" | "error" | "closed";

export class ConnectionOverlay {
  private root!: HTMLElement;
  private statusEl!: HTMLElement;
  private createBtn!: HTMLButtonElement;
  private joinRow!: HTMLElement;
  private joinInput!: HTMLInputElement;
  private joinBtn!: HTMLButtonElement;
  private roomIdEl!: HTMLElement;
  private hintEl!: HTMLElement;
  /** Fail-closed banner (Phase 5). Hidden until the match is closed. */
  private closedBannerEl!: HTMLElement;
  /** Telemetry readout (Phase 5). Hidden until a match is live. */
  private telemetryEl!: HTMLElement;

  private status: Status = "idle";
  private net: NetClient | null = null;

  mount(): void {
    const parent = document.getElementById("game-container") ?? document.body;

    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;z-index:100;font-family:monospace;";

    // ── Connection status badge ──────────────────────────────────────────────
    this.statusEl = document.createElement("div");
    this.statusEl.dataset.testid = "net-status";
    this.statusEl.style.cssText =
      "position:absolute;top:8px;right:8px;padding:4px 10px;" +
      "background:rgba(0,0,0,0.6);border-radius:4px;color:#aaa;font-size:12px;" +
      "pointer-events:none;";
    this.statusEl.textContent = "disconnected";
    this.root.appendChild(this.statusEl);

    // ── Room panel ───────────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);" +
      "background:rgba(0,0,0,0.75);border-radius:8px;padding:20px 28px;" +
      "display:flex;flex-direction:column;gap:10px;align-items:center;" +
      "pointer-events:auto;";
    this.root.appendChild(panel);

    const title = document.createElement("div");
    title.textContent = "Networked 1v1";
    title.style.cssText = "color:#fff;font-size:16px;font-weight:bold;";
    panel.appendChild(title);

    // Create button
    this.createBtn = document.createElement("button");
    this.createBtn.dataset.testid = "room-create";
    this.createBtn.textContent = "Create Room";
    this.createBtn.style.cssText =
      "padding:8px 18px;cursor:pointer;font-family:monospace;font-size:13px;" +
      "background:#2255aa;color:#fff;border:none;border-radius:4px;width:140px;";
    panel.appendChild(this.createBtn);

    // Join row
    this.joinRow = document.createElement("div");
    this.joinRow.style.cssText = "display:flex;gap:6px;align-items:center;";
    panel.appendChild(this.joinRow);

    this.joinInput = document.createElement("input");
    this.joinInput.dataset.testid = "room-join";
    this.joinInput.placeholder = "Room ID";
    this.joinInput.style.cssText =
      "padding:6px 8px;font-family:monospace;font-size:12px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;width:90px;";
    this.joinRow.appendChild(this.joinInput);

    this.joinBtn = document.createElement("button");
    this.joinBtn.textContent = "Join";
    this.joinBtn.style.cssText =
      "padding:6px 12px;cursor:pointer;font-family:monospace;font-size:12px;" +
      "background:#225522;color:#fff;border:none;border-radius:4px;";
    this.joinRow.appendChild(this.joinBtn);

    // Room ID display (shown after create)
    this.roomIdEl = document.createElement("div");
    this.roomIdEl.dataset.testid = "room-id";
    this.roomIdEl.style.cssText =
      "color:#ffe066;font-size:14px;font-weight:bold;min-height:18px;letter-spacing:2px;";
    panel.appendChild(this.roomIdEl);

    // Hint line under the room ID (e.g. "waiting for opponent")
    this.hintEl = document.createElement("div");
    this.hintEl.style.cssText = "color:#aaa;font-size:11px;min-height:14px;";
    panel.appendChild(this.hintEl);

    // ── Fail-closed banner (Phase 5) ─────────────────────────────────────────
    // Shown (centred, full-width) when the match ends due to a disconnect.
    // Hidden by default; shown via showFailClosed().
    this.closedBannerEl = document.createElement("div");
    this.closedBannerEl.dataset.testid = "net-closed";
    this.closedBannerEl.style.cssText =
      "display:none;position:absolute;top:50%;left:50%;" +
      "transform:translate(-50%,-50%);" +
      "background:rgba(0,0,0,0.82);border:2px solid #ff5555;border-radius:8px;" +
      "padding:20px 32px;color:#ff5555;font-size:20px;font-weight:bold;" +
      "text-align:center;pointer-events:none;z-index:200;";
    this.closedBannerEl.textContent = "Match Over — Opponent Left";
    this.root.appendChild(this.closedBannerEl);

    // ── Telemetry readout (Phase 5) ───────────────────────────────────────────
    // Shows RTT in the corner during an active match. Hidden by default.
    this.telemetryEl = document.createElement("div");
    this.telemetryEl.dataset.testid = "net-telemetry";
    this.telemetryEl.style.cssText =
      "display:none;position:absolute;bottom:8px;right:8px;" +
      "background:rgba(0,0,0,0.5);border-radius:4px;padding:2px 8px;" +
      "color:#88cc88;font-size:11px;pointer-events:none;";
    this.root.appendChild(this.telemetryEl);

    parent.appendChild(this.root);
  }

  /**
   * Wire callbacks to a NetClient instance. Called by GameScene after mount().
   *
   * @param onRoomFull     Phase 2: called with the local slot + active-slot
   *                       template once all players are present so GameScene
   *                       can start the NetLoop.
   * @param onSessionStart Called once create/join succeeds (room connected, but
   *                       possibly awaiting an opponent) so GameScene can freeze
   *                       the local background sim.
   */
  wire(
    net: NetClient,
    canvas: HTMLCanvasElement,
    onRoomFull?: (slot: Slot, slots?: PlayerSlotId[]) => void,
    onSessionStart?: () => void,
  ): void {
    this.net = net;
    this.onRoomFull = onRoomFull ?? null;
    this.onSessionStart = onSessionStart ?? null;

    this.createBtn.addEventListener("click", () => {
      void this.handleCreate();
    });

    this.joinBtn.addEventListener("click", () => {
      const id = this.joinInput.value.trim();
      if (id) void this.handleJoin(id);
    });

    // B can also press Enter in the join input to join.
    this.joinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const id = this.joinInput.value.trim();
        if (id) void this.handleJoin(id);
      }
    });

    // Keep overlay aligned with canvas (mirrors GameScene.updateMatchHud pattern)
    const align = () => {
      this.root.style.left = `${canvas.offsetLeft}px`;
      this.root.style.top = `${canvas.offsetTop}px`;
      this.root.style.width = `${canvas.clientWidth}px`;
      this.root.style.height = `${canvas.clientHeight}px`;
    };
    const observer = new ResizeObserver(align);
    observer.observe(canvas);
    align();
  }

  private onRoomFull: ((slot: Slot, slots?: PlayerSlotId[]) => void) | null =
    null;
  private onSessionStart: (() => void) | null = null;

  private async handleCreate(): Promise<void> {
    if (!this.net) return;
    const net = this.net;
    this.setStatus("connecting");
    try {
      const roomId = await net.create();
      this.onSessionStart?.();
      this.roomIdEl.textContent = roomId;
      this.setStatus("connected");
      // Collapse the controls but keep the Room ID visible so the creator
      // can share it. Hide the whole panel only once the opponent joins.
      this.createBtn.style.display = "none";
      this.joinRow.style.display = "none";
      this.hintEl.textContent = "Waiting for opponent to join…";
      this.hintEl.style.color = "#ffe066";
      this.hintEl.style.fontSize = "13px";
      net.onMessage("RoomReady", (msg) => {
        const m = msg as {
          slot: number;
          full: boolean;
          slots?: PlayerSlotId[];
        };
        net.slot = m.slot as PlayerSlotId;
        this.updateBadge(`connected (slot ${m.slot})`);
        if (m.full) {
          this.hidePanel();
          this.onRoomFull?.(m.slot as Slot, m.slots);
        }
      });
      net.onLeave((_code) => {
        this.setStatus("error");
        this.updateBadge("disconnected");
      });
    } catch (err) {
      console.error("[ConnectionOverlay] create failed", err);
      this.setStatus("error");
    }
  }

  private async handleJoin(id: string): Promise<void> {
    if (!this.net) return;
    const net = this.net;
    this.setStatus("connecting");
    try {
      await net.joinById(id);
      this.onSessionStart?.();
      this.setStatus("connected");
      this.hidePanel();
      net.onMessage("RoomReady", (msg) => {
        const m = msg as {
          slot: number;
          full: boolean;
          slots?: PlayerSlotId[];
        };
        net.slot = m.slot as PlayerSlotId;
        this.updateBadge(`connected (slot ${m.slot})`);
        // When B joins, the room is immediately full from B's perspective.
        this.onRoomFull?.(m.slot as Slot, m.slots);
      });
      net.onLeave((_code) => {
        this.setStatus("error");
        this.updateBadge("disconnected");
      });
    } catch (err) {
      console.error("[ConnectionOverlay] join failed", err);
      this.setStatus("error");
    }
  }

  private hidePanel(): void {
    // Hide the create/join panel once connected; badge stays visible
    const panel = this.root.children[1] as HTMLElement | undefined;
    if (panel) panel.style.display = "none";
  }

  private setStatus(s: Status): void {
    this.status = s;
    const labels: Record<Status, string> = {
      idle: "disconnected",
      connecting: "connecting…",
      connected: "connected",
      error: "error",
      closed: "match over",
    };
    this.updateBadge(labels[s]);
  }

  private updateBadge(text: string): void {
    this.statusEl.textContent = text;
    const colors: Record<string, string> = {
      connected: "#55ff88",
      "connecting…": "#ffcc44",
      disconnected: "#aaaaaa",
      error: "#ff5555",
      "match over": "#ff5555",
    };
    const baseText = text.startsWith("connected") ? "connected" : text;
    this.statusEl.style.color = colors[baseText] ?? "#aaaaaa";
  }

  /**
   * Show the fail-closed banner and update the status badge.
   * Called by GameScene when a MatchClosed signal is received.
   *
   * @param reason  The reason string from MatchClosed or "ws-error".
   */
  showFailClosed(reason: MatchClosed["reason"] | "ws-error"): void {
    this.setStatus("closed");
    const messages: Record<string, string> = {
      "peer-left": "Match Over — Opponent Left",
      "server-shutdown": "Match Over — Server Shutdown",
      "ws-error": "Match Over — Connection Lost",
    };
    this.closedBannerEl.textContent =
      messages[reason] ?? "Match Over — Connection Lost";
    this.closedBannerEl.style.display = "block";
    // Show the telemetry element if it was visible (keeps the readout).
    // Hide the panel so the banner stands alone.
    this.hidePanel();
  }

  /**
   * Update the telemetry readout. Pass null to hide the element.
   *
   * @param rtt     Round-trip time in ms (from room.ping()).
   * @param ackLag  Unacked input lag (pending queue depth).
   */
  updateTelemetry(rtt: number | null, ackLag?: number): void {
    if (rtt === null) {
      this.telemetryEl.style.display = "none";
      return;
    }
    this.telemetryEl.style.display = "block";
    const lagStr = ackLag !== undefined ? ` lag:${ackLag}` : "";
    this.telemetryEl.textContent = `RTT:${rtt}ms${lagStr}`;
  }

  get currentStatus(): Status {
    return this.status;
  }

  destroy(): void {
    this.root?.remove();
  }
}
