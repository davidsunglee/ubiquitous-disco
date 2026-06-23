/**
 * Phase 7 (FLI-9): MatchSummary overlay renderer.
 *
 * Pure DOM helper — no Phaser dependency — so it can be unit-tested with jsdom.
 * Populates a container element with structured balance telemetry fields under
 * `data-testid="match-summary-*"` attributes (inline cssText, monospace/dark palette).
 *
 * Called by GameScene.renderMatchSummaryOverlay() and testable independently.
 */

import type { MatchSummary } from "@bb/protocol";
import type { PlayerSlotId } from "@bb/sim";
import { teamForPlayerSlot } from "@bb/sim";

/** Options controlling how the winner text is derived from the summary. */
export interface MatchSummaryRenderOptions {
  /**
   * Local player's slot id (used in networked mode to personalise
   * "YOU WIN" / "YOU LOSE"). Absent for hotseat.
   */
  localSlot?: PlayerSlotId;
  /** True when rendering in networked (server-authoritative) mode. */
  networked?: boolean;
}

/**
 * Clear `container` and populate it with structured match summary DOM children.
 * Each field gets a `data-testid="match-summary-{key}"` for test / e2e targeting.
 */
export function renderMatchSummaryDOM(
  container: HTMLElement,
  summary: MatchSummary,
  opts: MatchSummaryRenderOptions = {},
): void {
  // Clear previous content.
  container.textContent = "";

  // Helper: add a field row.
  const addRow = (testid: string, label: string, value: string): void => {
    const row = document.createElement("div");
    row.dataset.testid = `match-summary-${testid}`;
    row.style.cssText =
      "font-family:monospace;font-size:13px;margin:2px 0;color:#eee;";
    row.textContent = `${label}: ${value}`;
    container.appendChild(row);
  };

  // Winner / score header.
  let winnerText: string;
  if (summary.winner === "tie") {
    winnerText = "DRAW";
  } else if (opts.networked && opts.localSlot !== undefined) {
    const myTeam = teamForPlayerSlot(opts.localSlot);
    winnerText = summary.winner === myTeam ? "YOU WIN" : "YOU LOSE";
  } else {
    winnerText = `P${(summary.winner as number) + 1} WINS`;
  }

  const header = document.createElement("div");
  header.dataset.testid = "match-summary-winner";
  header.style.cssText =
    "font-family:monospace;font-size:20px;font-weight:bold;margin-bottom:6px;color:#ffe066;";
  header.textContent = `${winnerText} — Press Jump to Rematch`;
  container.appendChild(header);

  addRow("score", "Score", summary.scores.join(" - "));
  addRow("arena", "Arena", summary.arenaId);
  addRow("mode", "Mode", summary.mode);
  addRow("bell-rings", "Bell Rings", String(summary.bellRings));
  addRow("knockdowns", "Knockdowns", String(summary.knockdowns));
  addRow(
    "friendly-fire",
    "Friendly Fire KDs",
    String(summary.friendlyFireKnockdowns),
  );

  // Per-slot breakdown.
  for (const slot of summary.slots) {
    const label = `Slot ${slot.slotId}`;
    const value = `${slot.characterId}${slot.isBot ? " [BOT]" : ""}`;
    addRow(`slot-${slot.slotId}`, label, value);
  }

  // Net block (only show if there's meaningful network data).
  if (summary.net.rttMs > 0 || summary.net.disconnects > 0) {
    addRow("net-rtt", "Net RTT", `${summary.net.rttMs}ms`);
    addRow("net-disconnects", "Disconnects", String(summary.net.disconnects));
  }
}
