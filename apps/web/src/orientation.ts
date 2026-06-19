/**
 * Orientation utilities.
 *
 * - `attemptLandscapeLock()`: calls `screen.orientation.lock('landscape')`
 *   where supported (Android/PWA). iOS Safari throws/rejects — catch silently.
 * - `onOrientationChange(cb)`: fires `cb(isPortrait)` whenever the browser
 *   orientation changes; returns an unsubscribe function.
 */

/**
 * Attempt to lock the screen to landscape. This only works on Android browsers
 * and PWA-mode on iOS; a plain iOS Safari tab will reject the promise — we
 * catch and ignore that error so the rotate-device overlay handles it instead.
 */
export function attemptLandscapeLock(): void {
  if (
    typeof screen !== "undefined" &&
    screen.orientation &&
    typeof screen.orientation.lock === "function"
  ) {
    screen.orientation.lock("landscape").catch(() => {
      // Silently ignored: not supported (iOS Safari / desktop browsers).
    });
  }
}

/**
 * Register a callback invoked whenever the orientation changes.
 * The callback receives `true` when in portrait, `false` when in landscape.
 * Returns an unsubscribe function.
 */
export function onOrientationChange(
  cb: (isPortrait: boolean) => void,
): () => void {
  function handler() {
    const isPortrait = window.innerHeight > window.innerWidth;
    cb(isPortrait);
  }

  if (
    typeof screen !== "undefined" &&
    screen.orientation &&
    "addEventListener" in screen.orientation
  ) {
    screen.orientation.addEventListener("change", handler);
    return () =>
      screen.orientation.removeEventListener(
        "change",
        handler as EventListenerOrEventListenerObject,
      );
  }

  // Fallback: window resize (covers all browsers).
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
}

/** Returns true when the current viewport is portrait. */
export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}
