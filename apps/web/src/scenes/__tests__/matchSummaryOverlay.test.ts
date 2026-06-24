/**
 * Phase 7 (FLI-9): matchSummaryOverlay unit tests.
 *
 * Verifies that renderMatchSummaryDOM() populates a DOM container with
 * structured `data-testid="match-summary-*"` fields from a fixture MatchSummary.
 * Tests run in jsdom (no Phaser dependency).
 */

import type { MatchSummary } from "@bb/protocol";
import { beforeEach, describe, expect, test } from "vitest";
import { renderMatchSummaryDOM } from "../matchSummaryOverlay";

/** Fixture MatchSummary for a 1v1 match. */
const fixtureSummary: MatchSummary = {
  type: "MatchSummary",
  launchId: "L-fixture",
  arenaId: "dune-basin",
  mode: "1v1",
  durationTicks: 540,
  scores: [2, 1],
  winner: 0,
  slots: [
    { slotId: 0, characterId: "sifu", isBot: false },
    { slotId: 2, characterId: "panda", isBot: true },
  ],
  bellRings: 3,
  knockdowns: 5,
  friendlyFireKnockdowns: 0,
  botSlots: [2],
  net: { rttMs: 0, jitterMs: 0, reconciliationCorrections: 0, disconnects: 0 },
};

let container: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

function q(testid: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

describe("renderMatchSummaryDOM", () => {
  test("populates the winner testid with win text (hotseat)", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-winner");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("P1 WINS");
  });

  test("populates score field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-score");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("2 - 1");
  });

  test("populates arena field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-arena");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("dune-basin");
  });

  test("populates mode field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-mode");
    expect(el?.textContent).toContain("1v1");
  });

  test("populates bell-rings field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-bell-rings");
    expect(el?.textContent).toContain("3");
  });

  test("populates knockdowns field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-knockdowns");
    expect(el?.textContent).toContain("5");
  });

  test("populates friendly-fire knockdown field", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const el = q("match-summary-friendly-fire");
    expect(el?.textContent).toContain("0");
  });

  test("populates per-slot breakdown for each slot", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    const slot0 = q("match-summary-slot-0");
    const slot2 = q("match-summary-slot-2");
    expect(slot0?.textContent).toContain("sifu");
    expect(slot2?.textContent).toContain("panda");
    expect(slot2?.textContent).toContain("[BOT]");
    expect(slot0?.textContent).not.toContain("[BOT]");
  });

  test("shows DRAW for tie result", () => {
    const tieSummary: MatchSummary = { ...fixtureSummary, winner: "tie" };
    renderMatchSummaryDOM(container, tieSummary);
    const el = q("match-summary-winner");
    expect(el?.textContent).toContain("DRAW");
  });

  test("shows YOU WIN when networked and winner matches local slot's team", () => {
    // Slot 0 is on Team 0; winner = 0 → YOU WIN
    renderMatchSummaryDOM(container, fixtureSummary, {
      networked: true,
      localSlot: 0,
    });
    const el = q("match-summary-winner");
    expect(el?.textContent).toContain("YOU WIN");
  });

  test("shows YOU LOSE when networked and winner does not match local slot's team", () => {
    // Slot 2 is on Team 1; winner = 0 (Team 0 won) → YOU LOSE
    renderMatchSummaryDOM(container, fixtureSummary, {
      networked: true,
      localSlot: 2,
    });
    const el = q("match-summary-winner");
    expect(el?.textContent).toContain("YOU LOSE");
  });

  test("does not show net-rtt when rttMs is 0 and disconnects is 0", () => {
    renderMatchSummaryDOM(container, fixtureSummary);
    // Net RTT row should be absent when both rttMs=0 and disconnects=0.
    const el = q("match-summary-net-rtt");
    expect(el).toBeNull();
  });

  test("shows net-rtt when rttMs > 0", () => {
    const netSummary: MatchSummary = {
      ...fixtureSummary,
      net: {
        rttMs: 55,
        jitterMs: 3,
        reconciliationCorrections: 2,
        disconnects: 1,
      },
    };
    renderMatchSummaryDOM(container, netSummary);
    const el = q("match-summary-net-rtt");
    expect(el?.textContent).toContain("55ms");
    const disco = q("match-summary-net-disconnects");
    expect(disco?.textContent).toContain("1");
  });

  test("clears previous content before rendering", () => {
    container.textContent = "stale content";
    renderMatchSummaryDOM(container, fixtureSummary);
    // The "stale content" text node should be gone.
    expect(container.textContent).not.toContain("stale content");
  });
});
