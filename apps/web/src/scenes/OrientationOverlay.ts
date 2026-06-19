/**
 * OrientationOverlay — pauses the game and shows a "rotate device" prompt
 * whenever the viewport is in portrait mode.
 *
 * This is a DOM-based overlay (not a Phaser scene) so it works reliably on
 * iOS Safari where `screen.orientation.lock()` is unsupported. The element
 * carries `data-testid="rotate-prompt"` for Playwright assertions.
 *
 * Usage:
 *   const overlay = new OrientationOverlay();
 *   overlay.mount();       // once, in GameScene.create()
 *   overlay.destroy();     // on scene shutdown (optional)
 *
 * The overlay listens to `resize` / `orientationchange` events and
 * automatically shows/hides and calls the supplied pause/resume callbacks.
 *
 * A CSS `@media (orientation: portrait)` rule in index.html provides a
 * visual-only fallback for environments where JS hasn't run yet.
 */

export interface OrientationOverlayOptions {
  /** Called when the device enters portrait mode (overlay shown). */
  onPortrait?: () => void;
  /** Called when the device returns to landscape mode (overlay hidden). */
  onLandscape?: () => void;
}

export class OrientationOverlay {
  private el: HTMLElement | null = null;
  private readonly opts: OrientationOverlayOptions;
  private readonly boundHandler: () => void;

  constructor(opts: OrientationOverlayOptions = {}) {
    this.opts = opts;
    this.boundHandler = () => this.update();
  }

  /** Insert the overlay element into the DOM and start listening for changes. */
  mount(): void {
    if (this.el) return; // already mounted

    this.el = document.createElement("div");
    this.el.dataset.testid = "rotate-prompt";
    this.el.setAttribute(
      "aria-label",
      "Please rotate your device to landscape",
    );
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");

    // Styles: full-viewport dark overlay with centred text.
    Object.assign(this.el.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999",
      background: "rgba(0,0,0,0.92)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "#ffffff",
      fontFamily: "monospace, sans-serif",
      fontSize: "1.2rem",
      textAlign: "center",
      padding: "2rem",
      // Start hidden; update() will show/hide.
      visibility: "hidden",
      pointerEvents: "none",
    } as CSSStyleDeclaration);

    this.el.innerHTML = `
      <div style="font-size:3rem;margin-bottom:1rem">&#8635;</div>
      <div>Please rotate your device</div>
      <div style="font-size:0.85rem;margin-top:0.5rem;opacity:0.7">
        This game is best played in landscape mode
      </div>
    `;

    document.body.appendChild(this.el);

    // Listen on both `resize` and `orientationchange` for broadest coverage.
    window.addEventListener("resize", this.boundHandler);
    window.addEventListener("orientationchange", this.boundHandler);

    // Run immediately to set initial state.
    this.update();
  }

  /** Remove the overlay element and stop listeners. */
  destroy(): void {
    window.removeEventListener("resize", this.boundHandler);
    window.removeEventListener("orientationchange", this.boundHandler);
    this.el?.remove();
    this.el = null;
  }

  /** Returns true when the overlay is currently visible (portrait mode). */
  get isVisible(): boolean {
    return this.el?.style.visibility === "visible";
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private update(): void {
    const portrait = window.innerHeight > window.innerWidth;

    if (!this.el) return;

    if (portrait) {
      this.el.style.visibility = "visible";
      this.el.style.pointerEvents = "auto";
      this.opts.onPortrait?.();
    } else {
      this.el.style.visibility = "hidden";
      this.el.style.pointerEvents = "none";
      this.opts.onLandscape?.();
    }
  }
}
