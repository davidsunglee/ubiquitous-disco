/**
 * LobbyPage — DOM page showing the live Private Lobby state.
 *
 * Renders two Team columns (Team 0 = left/blue, Team 1 = right/red), each
 * showing the two Player Slots and their current occupants + presence status.
 * Updates in real-time as LobbyState messages arrive from the PrivateLobby DO.
 *
 * Host controls (Phase 5): the Host can fill/clear Practice Bot seats, pick the
 * match length, and start. On start, the worker hands back a MatchLaunch which
 * we stash (per-tab) and navigate into the Phaser match.
 *
 * Stable data-testid anchors (required for Playwright):
 *   lobby-code            — displays the lobby code
 *   lobby-slots           — wrapper around all four seat elements
 *   lobby-slot-{0..3}     — individual seat elements
 *   lobby-fill-bots       — fill all empty seats with bots (Host only)
 *   lobby-mode            — match-mode <select> ("1v1" | "2v2") (Host only)
 *   lobby-match-length    — match-length <select> (Host only)
 *   lobby-start-match     — start the match (Host only)
 *   lobby-slot-{n}-bot    — fill that empty seat with a bot (Host only)
 *   lobby-slot-{n}-clear  — clear the bot from that seat (Host only)
 */

import type {
  CharacterId,
  LobbySlot,
  LobbyState,
  MatchLaunch,
  PlayerSlotId,
} from "@bb/protocol";
import {
  CHARACTERS,
  MATCH_LENGTH_DEFAULT_TICKS,
  teamForPlayerSlot,
} from "@bb/protocol";
import { LobbyClient } from "./LobbyClient";
import { saveLaunch } from "./launchHandoff";
import { loadProfile } from "./profile";

/**
 * Player Slots required to be filled for each mode (mirrors the worker).
 * Used client-side to compute the "startable" condition for the Start button.
 */
const REQUIRED_SLOTS_BY_MODE: Record<"1v1" | "2v2", readonly PlayerSlotId[]> = {
  "1v1": [0, 2],
  "2v2": [0, 1, 2, 3],
};

/** Match-length options exposed in the Host picker (2:00–5:00 @ 30 Hz). */
const LENGTH_OPTIONS: { label: string; ticks: number }[] = [
  { label: "2:00", ticks: 3600 },
  { label: "2:30", ticks: 4500 },
  { label: "3:00", ticks: 5400 },
  { label: "4:00", ticks: 7200 },
  { label: "5:00", ticks: 9000 },
];

/** Arena options for the host picker. */
const ARENA_OPTIONS: { label: string; id: string }[] = [
  { label: "Flat Dojo", id: "flat-dojo" },
  { label: "Pillared Temple", id: "pillared-temple" },
  { label: "Twin Ledge", id: "twin-ledge" },
];

export class LobbyPage {
  private root!: HTMLElement;
  private client: LobbyClient | null = null;
  private slotEls = new Map<PlayerSlotId, HTMLElement>();
  private codeEl!: HTMLElement;
  private profile = loadProfile();
  private controlsEl!: HTMLElement;
  private modeSelect!: HTMLSelectElement;
  private lengthSelect!: HTMLSelectElement;
  private arenaSelect!: HTMLSelectElement;
  private startBtn!: HTMLButtonElement;
  private startHint!: HTMLElement;
  /** Latest known lobby state (used by seat-button handlers). */
  private lastState: LobbyState | null = null;

  mount(container: HTMLElement, code: string): void {
    const profile = this.profile;

    this.root = document.createElement("div");
    // max-height:100vh + overflow-y:auto make the lobby scroll *internally*: the
    // overlay's #lobby-container is position:fixed (viewport-height), so once the
    // content (slots + stat table + host controls) exceeds the viewport, the
    // Start button would otherwise overflow below the fold with no way to scroll
    // to it. box-sizing keeps the 32px padding inside the 100vh budget.
    this.root.style.cssText =
      "display:flex;flex-direction:column;align-items:center;" +
      "min-height:100vh;max-height:100vh;overflow-y:auto;box-sizing:border-box;" +
      "background:#1a1a1a;color:#eee;font-family:monospace;padding:32px 16px;gap:24px;" +
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

    // Stat table — always visible so players can compare before lock().
    const statTable = this.makeStatTable();
    this.root.appendChild(statTable);

    // Host controls (shown only when the local player is the Host).
    this.controlsEl = this.makeHostControls();
    this.root.appendChild(this.controlsEl);

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
    this.client.onLaunch((launch) => this.handleLaunch(launch));
    this.client.onNotice((notice) => this.handleNotice(notice));
    this.client.connect(code, profile.playerId, profile.displayName);
  }

  /** Build the (initially hidden) Host controls row. */
  private makeHostControls(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:none;flex-direction:column;gap:12px;align-items:center;" +
      "border-top:1px solid #333;padding-top:16px;width:100%;max-width:560px;";

    // Match mode picker.
    const modeRow = document.createElement("div");
    modeRow.style.cssText = "display:flex;gap:8px;align-items:center;";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Match mode:";
    modeLabel.style.cssText = "font-size:12px;color:#aaa;";
    modeRow.appendChild(modeLabel);

    this.modeSelect = document.createElement("select");
    this.modeSelect.dataset.testid = "lobby-mode";
    this.modeSelect.style.cssText =
      "padding:4px 8px;font-family:monospace;font-size:12px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;";
    for (const mode of ["1v1", "2v2"] as const) {
      const o = document.createElement("option");
      o.value = mode;
      o.textContent = mode;
      if (mode === "2v2") o.selected = true;
      this.modeSelect.appendChild(o);
    }
    this.modeSelect.addEventListener("change", () => {
      this.client?.sendCommand({
        type: "LobbyCommand",
        cmd: "setSettings",
        settings: { mode: this.modeSelect.value as "1v1" | "2v2" },
      });
    });
    modeRow.appendChild(this.modeSelect);
    wrap.appendChild(modeRow);

    // Match length picker.
    const lengthRow = document.createElement("div");
    lengthRow.style.cssText = "display:flex;gap:8px;align-items:center;";
    const lengthLabel = document.createElement("label");
    lengthLabel.textContent = "Match length:";
    lengthLabel.style.cssText = "font-size:12px;color:#aaa;";
    lengthRow.appendChild(lengthLabel);

    this.lengthSelect = document.createElement("select");
    this.lengthSelect.dataset.testid = "lobby-match-length";
    this.lengthSelect.style.cssText =
      "padding:4px 8px;font-family:monospace;font-size:12px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;";
    for (const opt of LENGTH_OPTIONS) {
      const o = document.createElement("option");
      o.value = String(opt.ticks);
      o.textContent = opt.label;
      if (opt.ticks === MATCH_LENGTH_DEFAULT_TICKS) o.selected = true;
      this.lengthSelect.appendChild(o);
    }
    this.lengthSelect.addEventListener("change", () => {
      this.client?.sendCommand({
        type: "LobbyCommand",
        cmd: "setSettings",
        settings: { matchLengthTicks: Number(this.lengthSelect.value) },
      });
    });
    lengthRow.appendChild(this.lengthSelect);
    wrap.appendChild(lengthRow);

    // Arena picker.
    const arenaRow = document.createElement("div");
    arenaRow.style.cssText = "display:flex;gap:8px;align-items:center;";
    const arenaLabel = document.createElement("label");
    arenaLabel.textContent = "Arena:";
    arenaLabel.style.cssText = "font-size:12px;color:#aaa;";
    arenaRow.appendChild(arenaLabel);

    this.arenaSelect = document.createElement("select");
    this.arenaSelect.dataset.testid = "lobby-arena";
    this.arenaSelect.style.cssText =
      "padding:4px 8px;font-family:monospace;font-size:12px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;";
    for (const opt of ARENA_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.label;
      if (opt.id === "flat-dojo") o.selected = true;
      this.arenaSelect.appendChild(o);
    }
    this.arenaSelect.addEventListener("change", () => {
      this.client?.sendCommand({
        type: "LobbyCommand",
        cmd: "setSettings",
        settings: { arenaId: this.arenaSelect.value },
      });
    });
    arenaRow.appendChild(this.arenaSelect);
    wrap.appendChild(arenaRow);

    // Action buttons.
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:12px;align-items:center;";

    const fillBtn = document.createElement("button");
    fillBtn.dataset.testid = "lobby-fill-bots";
    fillBtn.textContent = "Fill Empty Seats with Bots";
    fillBtn.style.cssText =
      "padding:8px 16px;cursor:pointer;font-family:monospace;font-size:12px;" +
      "background:#665500;color:#ffe;border:none;border-radius:4px;";
    fillBtn.addEventListener("click", () => this.fillEmptySeats());
    btnRow.appendChild(fillBtn);

    this.startBtn = document.createElement("button");
    this.startBtn.dataset.testid = "lobby-start-match";
    this.startBtn.textContent = "Start Match";
    this.startBtn.style.cssText =
      "padding:8px 20px;cursor:pointer;font-family:monospace;font-size:13px;" +
      "background:#227722;color:#fff;border:none;border-radius:4px;font-weight:bold;";
    this.startBtn.addEventListener("click", () => {
      this.client?.sendCommand({ type: "LobbyCommand", cmd: "start" });
    });
    btnRow.appendChild(this.startBtn);

    wrap.appendChild(btnRow);

    // Hint shown when start is disabled.
    this.startHint = document.createElement("p");
    this.startHint.style.cssText =
      "color:#aa7700;font-size:11px;margin:0;display:none;";
    this.startHint.textContent =
      "Waiting for a player or bot in every slot (no disconnected players).";
    wrap.appendChild(this.startHint);

    return wrap;
  }

  /** Fill every currently-empty seat with a Practice Bot. */
  private fillEmptySeats(): void {
    if (!this.lastState) return;
    for (const slot of this.lastState.slots) {
      if (slot.occupant === null) {
        this.client?.sendCommand({
          type: "LobbyCommand",
          cmd: "fillBot",
          slotId: slot.slotId,
        });
      }
    }
  }

  /** On launch: stash the per-tab payload and navigate into the Phaser match. */
  private handleLaunch(launch: MatchLaunch): void {
    saveLaunch(launch);
    // Clear the lobby hash to reveal the match, then reload so GameScene picks
    // up the launch payload on create().
    window.location.hash = "";
    window.location.reload();
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

  /**
   * Compute whether the lobby is in a startable state from the current
   * LobbyState: all mode-required slots must be filled by a present human or
   * a bot (no absent humans, no empty required slots).
   */
  private isStartable(state: LobbyState): boolean {
    const required =
      REQUIRED_SLOTS_BY_MODE[state.settings.mode] ??
      REQUIRED_SLOTS_BY_MODE["2v2"];
    for (const slotId of required) {
      const slot = state.slots.find((s) => s.slotId === slotId);
      if (!slot || slot.occupant === null) return false; // empty slot
      if (slot.occupant.kind === "human" && !slot.occupant.present)
        return false; // absent human
    }
    return true;
  }

  private render(state: LobbyState): void {
    this.lastState = state;
    const isHost = state.hostPlayerId === this.profile.playerId;
    this.controlsEl.style.display = isHost ? "flex" : "none";

    // Sync host-control selects from authoritative server state so they never
    // drift from a multi-tab or server-clamped value.
    if (isHost) {
      if (this.modeSelect.value !== state.settings.mode) {
        this.modeSelect.value = state.settings.mode;
      }
      const tickStr = String(state.settings.matchLengthTicks);
      if (this.lengthSelect.value !== tickStr) {
        this.lengthSelect.value = tickStr;
      }
      if (
        state.settings.arenaId &&
        this.arenaSelect.value !== state.settings.arenaId
      ) {
        this.arenaSelect.value = state.settings.arenaId;
      }
    }

    // Update the Start button enabled/disabled state.
    if (isHost) {
      const startable = this.isStartable(state);
      this.startBtn.disabled = !startable;
      this.startBtn.style.opacity = startable ? "1" : "0.45";
      this.startBtn.style.cursor = startable ? "pointer" : "not-allowed";
      this.startHint.style.display = startable ? "none" : "block";
    }

    const modeSlots = new Set<PlayerSlotId>(
      REQUIRED_SLOTS_BY_MODE[state.settings.mode],
    );
    for (const slot of state.slots) {
      this.renderSlot(
        slot,
        state.hostPlayerId,
        isHost,
        this.profile.playerId,
        modeSlots,
      );
    }
  }

  /** Handle a LobbyNotice from the server (lock guard rejection feedback). */
  private handleNotice(_notice: import("@bb/protocol").LobbyNotice): void {
    // The start button is already visually disabled when not startable.
    // A notice arriving means the server guard also rejected — no further
    // action needed beyond what the client-side disable already shows.
    // Future work: could show a toast/banner here.
  }

  private renderSlot(
    slot: LobbySlot,
    hostPlayerId: string,
    isHost = false,
    localPlayerId = "",
    modeSlots: Set<PlayerSlotId> = new Set([0, 1, 2, 3]),
  ): void {
    const el = this.slotEls.get(slot.slotId);
    if (!el) return;

    // Dim slots that are outside the current mode (e.g. slots 1 & 3 in 1v1).
    const inMode = modeSlots.has(slot.slotId);
    el.style.opacity = inMode ? "1" : "0.35";
    el.dataset.inMode = inMode ? "true" : "false";

    // Clear existing occupant content (keep the slot label).
    const slotLabel = el.firstChild as HTMLElement;
    el.innerHTML = "";
    el.appendChild(slotLabel);

    if (!slot.occupant) {
      el.dataset.occupant = "empty";
      el.style.borderColor = "#444";
      const empty = document.createElement("span");
      empty.textContent = inMode ? "— empty —" : "— n/a —";
      empty.style.cssText = "color:#555;font-size:12px;";
      el.appendChild(empty);
      // Only show the bot button for in-mode empty slots.
      if (isHost && inMode) {
        const botBtn = document.createElement("button");
        botBtn.dataset.testid = `lobby-slot-${slot.slotId}-bot`;
        botBtn.textContent = "+ Bot";
        botBtn.style.cssText =
          "margin-top:4px;padding:2px 8px;cursor:pointer;font-family:monospace;" +
          "font-size:10px;background:#444;color:#ccc;border:1px solid #666;border-radius:3px;";
        botBtn.addEventListener("click", () => {
          this.client?.sendCommand({
            type: "LobbyCommand",
            cmd: "fillBot",
            slotId: slot.slotId,
          });
        });
        el.appendChild(botBtn);
      }
      return;
    }

    if (slot.occupant.kind === "bot") {
      el.dataset.occupant = "bot";
      el.style.borderColor = "#886600";
      const botLabel = document.createElement("span");
      botLabel.textContent = "Practice Bot";
      botLabel.style.cssText = "color:#aa8800;font-size:12px;";
      el.appendChild(botLabel);
      if (isHost) {
        // Character picker for bot slots (host-controlled).
        const sel = this.makeCharacterSelect(
          slot.slotId,
          slot.occupant.characterId,
        );
        el.appendChild(sel);
        const clearBtn = document.createElement("button");
        clearBtn.dataset.testid = `lobby-slot-${slot.slotId}-clear`;
        clearBtn.textContent = "✕";
        clearBtn.style.cssText =
          "margin-top:4px;padding:2px 8px;cursor:pointer;font-family:monospace;" +
          "font-size:10px;background:#442222;color:#ccc;border:1px solid #663333;border-radius:3px;";
        clearBtn.addEventListener("click", () => {
          this.client?.sendCommand({
            type: "LobbyCommand",
            cmd: "clearBot",
            slotId: slot.slotId,
          });
        });
        el.appendChild(clearBtn);
      }
      return;
    }

    // Human occupant
    const { playerId, displayName, present, characterId } = slot.occupant;
    const occupantIsHost = playerId === hostPlayerId;
    const isOwnSeat = playerId === localPlayerId;

    el.dataset.occupant = "human";
    el.style.borderColor = present ? "#55aa55" : "#666";

    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;gap:6px;align-items:center;";

    const nameEl = document.createElement("span");
    nameEl.textContent = displayName;
    nameEl.style.cssText = `color:${present ? "#eee" : "#666"};font-size:13px;`;
    nameRow.appendChild(nameEl);

    if (occupantIsHost) {
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

    // Character picker for own seat.
    if (isOwnSeat) {
      const sel = this.makeCharacterSelect(slot.slotId, characterId);
      el.appendChild(sel);
    }
  }

  /** Build a character <select> for a given slot. */
  private makeCharacterSelect(
    slotId: PlayerSlotId,
    currentCharacterId: CharacterId,
  ): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.dataset.testid = `lobby-slot-${slotId}-character`;
    sel.style.cssText =
      "margin-top:4px;padding:2px 6px;font-family:monospace;font-size:10px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:3px;";
    for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = CHARACTERS[id].displayName;
      if (id === currentCharacterId) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      this.client?.sendCommand({
        type: "LobbyCommand",
        cmd: "setCharacter",
        slotId,
        characterId: sel.value as CharacterId,
      });
    });
    return sel;
  }

  /** Build the stat comparison table for all six characters. */
  private makeStatTable(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.dataset.testid = "lobby-stat-table";
    wrap.style.cssText =
      "width:100%;max-width:560px;overflow-x:auto;font-family:monospace;font-size:10px;";

    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%;color:#ccc;";

    // Header row
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headers = [
      "Character",
      "Speed",
      "Jump",
      "Dash Dist",
      "Dash CD",
      "Strike",
      "Reach",
    ];
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.cssText =
        "padding:3px 6px;text-align:left;color:#ffe066;border-bottom:1px solid #444;";
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // One row per character
    const tbody = document.createElement("tbody");
    for (const [, def] of Object.entries(CHARACTERS)) {
      const s = def.stats;
      const tr = document.createElement("tr");
      const cells = [
        def.displayName,
        `×${s.moveSpeed.toFixed(2)}`,
        `×${s.jumpSpeed.toFixed(2)}`,
        `×${s.dashDistance.toFixed(2)}`,
        `×${s.dashCooldown.toFixed(2)}`,
        `×${s.strikeImpulse.toFixed(2)}`,
        `×${s.strikeReach.toFixed(2)}`,
      ];
      for (const c of cells) {
        const td = document.createElement("td");
        td.textContent = c;
        td.style.cssText = "padding:3px 6px;border-bottom:1px solid #333;";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  destroy(): void {
    this.client?.close();
    this.client = null;
    this.root?.remove();
  }
}

// Validate teamForPlayerSlot is re-exported (used for future team column coloring).
void teamForPlayerSlot;
