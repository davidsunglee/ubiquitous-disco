/**
 * LobbyRouter — simple hash-based router for the lobby flow.
 *
 * Supported routes:
 *   #lobby         → LandingPage (create or join)
 *   #lobby/:code   → LobbyPage (presence view for that code)
 *
 * The router mounts the appropriate page into `container` and tears down the
 * previous page on navigation. The Phaser game lives alongside in the DOM and
 * is untouched by this router.
 */

import { LandingPage } from "./LandingPage";
import { LobbyPage } from "./LobbyPage";

type ActivePage =
  | { kind: "landing"; page: LandingPage }
  | { kind: "lobby"; page: LobbyPage }
  | null;

export class LobbyRouter {
  private container!: HTMLElement;
  private active: ActivePage = null;

  mount(container: HTMLElement): void {
    this.container = container;
    window.addEventListener("hashchange", this.handleHash);
    this.handleHash();
  }

  private handleHash = (): void => {
    const hash = window.location.hash;

    if (hash.startsWith("#lobby/")) {
      const code = hash.slice("#lobby/".length).trim().toUpperCase();
      if (code) {
        this.navigate("lobby", code);
        return;
      }
    }

    if (hash === "#lobby" || hash === "#lobby/") {
      this.navigate("landing", "");
      return;
    }

    // Any other hash (including empty = Phaser game) — tear down lobby UI.
    this.tearDown();
  };

  private navigate(kind: "landing" | "lobby", code: string): void {
    // Only re-mount if the destination changed.
    if (kind === "lobby" && this.active?.kind === "lobby") return;
    if (kind === "landing" && this.active?.kind === "landing") return;

    this.tearDown();

    if (kind === "landing") {
      const page = new LandingPage();
      page.mount(this.container);
      this.active = { kind: "landing", page };
    } else {
      const page = new LobbyPage();
      page.mount(this.container, code);
      this.active = { kind: "lobby", page };
    }
  }

  private tearDown(): void {
    if (!this.active) return;
    this.active.page.destroy();
    this.active = null;
  }

  destroy(): void {
    window.removeEventListener("hashchange", this.handleHash);
    this.tearDown();
  }
}
