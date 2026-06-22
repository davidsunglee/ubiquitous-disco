/**
 * LandingPage — DOM page for creating or joining a Private Lobby.
 *
 * Rendered into the document body when the URL hash is empty or #lobby/landing.
 * The page shows:
 *  - An editable display name field (persisted to localStorage)
 *  - A "Create Lobby" button
 *  - A "Join by code" input + button
 *
 * On create, calls the worker's /parties/private-lobby/:code endpoint to
 * generate a new code, then navigates to #lobby/:code.
 *
 * Stable data-testid anchors (required for Playwright):
 *   lobby-name, lobby-create, lobby-join-code, lobby-join
 */

import { WORKER_URL } from "./config";
import { loadProfile, saveDisplayName } from "./profile";

export class LandingPage {
  private root!: HTMLElement;

  mount(container: HTMLElement): void {
    const profile = loadProfile();

    this.root = document.createElement("div");
    this.root.style.cssText =
      "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "min-height:100vh;background:#1a1a1a;color:#eee;font-family:monospace;gap:16px;" +
      "pointer-events:auto;";

    // Title
    const title = document.createElement("h1");
    title.textContent = "Bell Brawl — Private Lobby";
    title.style.cssText = "color:#ffe066;font-size:24px;margin:0 0 16px;";
    this.root.appendChild(title);

    // Display name input
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Display name:";
    nameLabel.style.cssText = "font-size:13px;color:#aaa;";
    nameRow.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.dataset.testid = "lobby-name";
    nameInput.value = profile.displayName;
    nameInput.style.cssText =
      "padding:6px 10px;font-family:monospace;font-size:13px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;width:140px;";
    nameInput.addEventListener("input", () => {
      saveDisplayName(nameInput.value);
    });
    nameRow.appendChild(nameInput);
    this.root.appendChild(nameRow);

    // Create Lobby button
    const createBtn = document.createElement("button");
    createBtn.dataset.testid = "lobby-create";
    createBtn.textContent = "Create Lobby";
    createBtn.style.cssText =
      "padding:10px 24px;cursor:pointer;font-family:monospace;font-size:14px;" +
      "background:#2255aa;color:#fff;border:none;border-radius:4px;";
    createBtn.addEventListener("click", () => {
      void this.handleCreate(nameInput.value);
    });
    this.root.appendChild(createBtn);

    // Divider
    const divider = document.createElement("div");
    divider.textContent = "— or —";
    divider.style.cssText = "color:#555;font-size:12px;";
    this.root.appendChild(divider);

    // Join by code row
    const joinRow = document.createElement("div");
    joinRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const joinInput = document.createElement("input");
    joinInput.dataset.testid = "lobby-join-code";
    joinInput.placeholder = "Lobby code";
    joinInput.style.cssText =
      "padding:6px 10px;font-family:monospace;font-size:13px;" +
      "background:#222;color:#eee;border:1px solid #555;border-radius:4px;width:120px;" +
      "text-transform:uppercase;letter-spacing:2px;";
    joinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const code = joinInput.value.trim().toUpperCase();
        if (code) this.navigateToLobby(code, nameInput.value);
      }
    });
    joinRow.appendChild(joinInput);

    const joinBtn = document.createElement("button");
    joinBtn.dataset.testid = "lobby-join";
    joinBtn.textContent = "Join";
    joinBtn.style.cssText =
      "padding:8px 16px;cursor:pointer;font-family:monospace;font-size:13px;" +
      "background:#225522;color:#fff;border:none;border-radius:4px;";
    joinBtn.addEventListener("click", () => {
      const code = joinInput.value.trim().toUpperCase();
      if (code) this.navigateToLobby(code, nameInput.value);
    });
    joinRow.appendChild(joinBtn);
    this.root.appendChild(joinRow);

    container.appendChild(this.root);
  }

  private async handleCreate(displayName: string): Promise<void> {
    saveDisplayName(displayName);

    // Generate a random 6-character alphanumeric code (A-Z0-9).
    // The worker uses the code as the DO name — no server round-trip needed for
    // Phase 4; just navigate straight to the lobby. The PrivateLobby DO is
    // created lazily on first WebSocket connection.
    const code = generateCode();
    this.navigateToLobby(code, displayName);
  }

  private navigateToLobby(code: string, displayName: string): void {
    saveDisplayName(displayName);
    window.location.hash = `#lobby/${code}`;
  }

  destroy(): void {
    this.root?.remove();
  }
}

/** Generate a random 6-character alphanumeric lobby code (upper-case). */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid O/0, I/1 confusion
  let code = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) {
    code += chars[b % chars.length];
  }
  return code;
}

// Keep the WORKER_URL import used (even though Phase 4 doesn't need it for
// code creation; Phase 5 will use it for the lock() call).
void WORKER_URL;
