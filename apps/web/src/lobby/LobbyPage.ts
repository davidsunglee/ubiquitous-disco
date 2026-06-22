/**
 * LobbyPage — DOM page showing the live Private Lobby state.
 *
 * Renders two Team columns (Team 0 = left/blue, Team 1 = right/red), each
 * showing the two Player Slots and their current occupants + presence status.
 * Updates in real-time as LobbyState messages arrive from the PrivateLobby DO.
 *
 * Stable data-testid anchors (required for Playwright):
 *   lobby-code            — displays the lobby code
 *   lobby-slots           — wrapper around all four seat elements
 *   lobby-slot-{0..3}     — individual seat elements
 */

import type { LobbySlot, LobbyState, PlayerSlotId } from "@bb/protocol";
import { teamForPlayerSlot } from "@bb/protocol";
import { LobbyClient } from "./LobbyClient";
import { loadProfile } from "./profile";

export class LobbyPage {
  private root!: HTMLElement;
  private client: LobbyClient | null = null;
  private slotEls = new Map<PlayerSlotId, HTMLElement>();
  private codeEl!: HTMLElement;

  mount(container: HTMLElement, code: string): void {
    const profile = loadProfile();

    this.root = document.createElement("div");
    this.root.style.cssText =
      "display:flex;flex-direction:column;align-items:center;" +
      "min-height:100vh;background:#1a1a1a;color:#eee;font-family:monospace;padding:32px 16px;gap:24px;" +
      "pointer-events:auto;";

    // Title + code display
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;flex-direction:column;align-items:center;gap:8px;";

    const title = document.createElement("h1");
    title.textContent = "Private Lobby";
    title.style.cssText = "color:#ffe066;font-size:22px;margin:0;";
    header.appendChild(title);

    const codeRow = document.createElement("div");
    codeRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const codeLabel = document.createElement("span");
    codeLabel.textContent = "Code:";
    codeLabel.style.cssText = "font-size:13px;color:#aaa;";
    codeRow.appendChild(codeLabel);

    this.codeEl = document.createElement("span");
    this.codeEl.dataset.testid = "lobby-code";
    this.codeEl.textContent = code;
    this.codeEl.style.cssText =
      "font-size:20px;font-weight:bold;color:#ffe066;" +
      "letter-spacing:4px;cursor:pointer;";
    this.codeEl.title = "Click to copy";
    this.codeEl.addEventListener("click", () => {
      void navigator.clipboard.writeText(code);
    });
    codeRow.appendChild(this.codeEl);

    header.appendChild(codeRow);
    this.root.appendChild(header);

    // Hint
    const hint = document.createElement("p");
    hint.textContent = "Share the code with friends to invite them.";
    hint.style.cssText = "color:#888;font-size:12px;margin:0;";
    this.root.appendChild(hint);

    // Team columns
    const teamsRow = document.createElement("div");
    teamsRow.dataset.testid = "lobby-slots";
    teamsRow.style.cssText =
      "display:flex;gap:32px;align-items:flex-start;justify-content:center;width:100%;max-width:560px;";

    const team0Col = this.makeTeamColumn("Team 0", "#4488ff", [
      0, 1,
    ] as PlayerSlotId[]);
    const team1Col = this.makeTeamColumn("Team 1", "#ff4444", [
      2, 3,
    ] as PlayerSlotId[]);

    teamsRow.appendChild(team0Col);
    teamsRow.appendChild(team1Col);
    this.root.appendChild(teamsRow);

    // Back button
    const backBtn = document.createElement("button");
    backBtn.textContent = "Back to Menu";
    backBtn.style.cssText =
      "padding:8px 16px;cursor:pointer;font-family:monospace;font-size:12px;" +
      "background:#333;color:#aaa;border:1px solid #555;border-radius:4px;margin-top:16px;";
    backBtn.addEventListener("click", () => {
      window.location.hash = "";
    });
    this.root.appendChild(backBtn);

    container.appendChild(this.root);

    // Connect to the lobby WebSocket.
    this.client = new LobbyClient();
    this.client.onState((state) => this.render(state));
    this.client.connect(code, profile.playerId, profile.displayName);
  }

  private makeTeamColumn(
    label: string,
    color: string,
    slots: PlayerSlotId[],
  ): HTMLElement {
    const col = document.createElement("div");
    col.style.cssText =
      `display:flex;flex-direction:column;gap:12px;align-items:center;` +
      `border:2px solid ${color}40;border-radius:8px;padding:16px;min-width:200px;`;

    const teamLabel = document.createElement("div");
    teamLabel.textContent = label;
    teamLabel.style.cssText = `color:${color};font-size:14px;font-weight:bold;`;
    col.appendChild(teamLabel);

    for (const slotId of slots) {
      const slotEl = this.makeSlotElement(slotId);
      this.slotEls.set(slotId, slotEl);
      col.appendChild(slotEl);
    }

    return col;
  }

  private makeSlotElement(slotId: PlayerSlotId): HTMLElement {
    const el = document.createElement("div");
    el.dataset.testid = `lobby-slot-${slotId}`;
    el.style.cssText =
      "width:100%;padding:10px 14px;border-radius:6px;" +
      "background:#2a2a2a;border:1px solid #444;font-size:13px;" +
      "display:flex;flex-direction:column;gap:4px;min-height:56px;";

    const slotLabel = document.createElement("span");
    slotLabel.textContent = `Slot ${slotId}`;
    slotLabel.style.cssText = "color:#666;font-size:10px;";
    el.appendChild(slotLabel);

    const occupantEl = document.createElement("span");
    occupantEl.textContent = "— empty —";
    occupantEl.style.cssText = "color:#555;font-size:12px;";
    el.dataset.occupant = "empty";
    el.appendChild(occupantEl);

    return el;
  }

  private render(state: LobbyState): void {
    for (const slot of state.slots) {
      this.renderSlot(slot, state.hostPlayerId);
    }
  }

  private renderSlot(slot: LobbySlot, hostPlayerId: string): void {
    const el = this.slotEls.get(slot.slotId);
    if (!el) return;

    // Clear existing occupant content (keep the slot label).
    const slotLabel = el.firstChild as HTMLElement;
    el.innerHTML = "";
    el.appendChild(slotLabel);

    if (!slot.occupant) {
      el.dataset.occupant = "empty";
      el.style.borderColor = "#444";
      const empty = document.createElement("span");
      empty.textContent = "— empty —";
      empty.style.cssText = "color:#555;font-size:12px;";
      el.appendChild(empty);
      return;
    }

    if (slot.occupant.kind === "bot") {
      el.dataset.occupant = "bot";
      el.style.borderColor = "#886600";
      const botLabel = document.createElement("span");
      botLabel.textContent = "Practice Bot";
      botLabel.style.cssText = "color:#aa8800;font-size:12px;";
      el.appendChild(botLabel);
      return;
    }

    // Human occupant
    const { playerId, displayName, present } = slot.occupant;
    const isHost = playerId === hostPlayerId;

    el.dataset.occupant = "human";
    el.style.borderColor = present ? "#55aa55" : "#666";

    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;gap:6px;align-items:center;";

    const nameEl = document.createElement("span");
    nameEl.textContent = displayName;
    nameEl.style.cssText = `color:${present ? "#eee" : "#666"};font-size:13px;`;
    nameRow.appendChild(nameEl);

    if (isHost) {
      const hostBadge = document.createElement("span");
      hostBadge.textContent = "Host";
      hostBadge.style.cssText =
        "font-size:9px;background:#2255aa;color:#aaddff;" +
        "border-radius:3px;padding:1px 4px;";
      nameRow.appendChild(hostBadge);
    }

    el.appendChild(nameRow);

    const presenceEl = document.createElement("span");
    presenceEl.textContent = present ? "online" : "disconnected";
    presenceEl.style.cssText = `color:${present ? "#55aa55" : "#aa5555"};font-size:10px;`;
    el.appendChild(presenceEl);
  }

  destroy(): void {
    this.client?.close();
    this.client = null;
    this.root?.remove();
  }
}

// Validate teamForPlayerSlot is re-exported (used for future team column coloring).
void teamForPlayerSlot;
