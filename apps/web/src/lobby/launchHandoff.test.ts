import type { MatchLaunch } from "@bb/protocol";
import { afterEach, expect, test } from "vitest";
import {
  hasLaunchJoined,
  markLaunchJoined,
  peekLaunch,
  saveLaunch,
  takeLaunch,
} from "./launchHandoff";

const launch: MatchLaunch = {
  type: "MatchLaunch",
  launchId: "launch-1",
  playerSlotId: 0,
  joinToken: "token-1",
};

afterEach(() => {
  sessionStorage.clear();
});

test("saveLaunch clears prior joined marker for a fresh handoff", () => {
  markLaunchJoined("old-launch");

  saveLaunch(launch);

  expect(peekLaunch()).toEqual(launch);
  expect(hasLaunchJoined("old-launch")).toBe(false);
  expect(hasLaunchJoined(launch.launchId)).toBe(false);
});

test("markLaunchJoined makes retained launches reconnect-only", () => {
  saveLaunch(launch);

  markLaunchJoined(launch.launchId);

  expect(hasLaunchJoined(launch.launchId)).toBe(true);
  expect(hasLaunchJoined("another-launch")).toBe(false);
});

test("takeLaunch clears both retained launch and joined marker", () => {
  saveLaunch(launch);
  markLaunchJoined(launch.launchId);

  expect(takeLaunch()).toEqual(launch);

  expect(peekLaunch()).toBeNull();
  expect(hasLaunchJoined(launch.launchId)).toBe(false);
});
