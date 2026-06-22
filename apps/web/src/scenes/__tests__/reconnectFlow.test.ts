/**
 * reconnectFlow tests (FLI-8 reconnect bug fixes).
 *
 * Covers the pure logic extracted out of GameScene so the bug-prone reconnect
 * wiring is unit-testable without standing up Phaser:
 *
 *  - shouldAttemptReconnect(): the reconnect-decision predicate previously
 *    copy-pasted into three fail-closed handlers.
 *  - wireFailClosed(): registers fail-closed wiring EXACTLY ONCE per NetClient
 *    instance (BUG #1 — duplicate handlers on the same room must not stack and
 *    fight each other).
 */

import { describe, expect, test, vi } from "vitest";
import {
  type FailClosedReason,
  shouldAttemptReconnect,
  wireFailClosed,
} from "../reconnectFlow";

describe("shouldAttemptReconnect", () => {
  test("true when a launch is retained, not already reconnecting, recoverable reason", () => {
    expect(
      shouldAttemptReconnect("peer-left", {
        hasRetainedLaunch: true,
        reconnecting: false,
      }),
    ).toBe(true);
    expect(
      shouldAttemptReconnect("ws-error", {
        hasRetainedLaunch: true,
        reconnecting: false,
      }),
    ).toBe(true);
  });

  test("false without a retained launch", () => {
    expect(
      shouldAttemptReconnect("peer-left", {
        hasRetainedLaunch: false,
        reconnecting: false,
      }),
    ).toBe(false);
  });

  test("false while a reconnect is already in flight", () => {
    expect(
      shouldAttemptReconnect("peer-left", {
        hasRetainedLaunch: true,
        reconnecting: true,
      }),
    ).toBe(false);
  });

  test("false on terminal reasons (expired grace / server shutdown)", () => {
    expect(
      shouldAttemptReconnect("reconnect-expired", {
        hasRetainedLaunch: true,
        reconnecting: false,
      }),
    ).toBe(false);
    expect(
      shouldAttemptReconnect("server-shutdown", {
        hasRetainedLaunch: true,
        reconnecting: false,
      }),
    ).toBe(false);
  });
});

describe("wireFailClosed", () => {
  test("registers onFailClosed exactly once per NetClient instance", () => {
    const net = { onFailClosed: vi.fn() };
    const cb = vi.fn();

    wireFailClosed(net, cb);
    wireFailClosed(net, cb);

    // BUG #1: even if called twice for the same instance, only ONE
    // registration may reach the (stacking) SDK room.
    expect(net.onFailClosed).toHaveBeenCalledTimes(1);
  });

  test("wires again on a fresh NetClient instance (reconnect path)", () => {
    const a = { onFailClosed: vi.fn() };
    const b = { onFailClosed: vi.fn() };
    const cb = vi.fn();

    wireFailClosed(a, cb);
    wireFailClosed(b, cb);

    expect(a.onFailClosed).toHaveBeenCalledTimes(1);
    expect(b.onFailClosed).toHaveBeenCalledTimes(1);
  });

  test("forwards the fail-closed reason to the callback", () => {
    const registered: Array<(reason: FailClosedReason) => void> = [];
    const net = {
      onFailClosed: (cb: (reason: FailClosedReason) => void) => {
        registered.push(cb);
      },
    };
    const cb = vi.fn();

    wireFailClosed(net, cb);
    registered[0]?.("peer-left");

    expect(cb).toHaveBeenCalledWith("peer-left");
  });
});
